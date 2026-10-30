import React from 'react';
import { X, Bell, AlertCircle, CheckCircle, Trash2, Volume2, VolumeX } from 'lucide-react';

export default function AlertsModal({
  isOpen,
  onClose,
  alerts = [],
  onClearAlerts,
  soundEnabled,
  onToggleSound,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center gap-2.5 text-slate-800 dark:text-white font-semibold text-lg">
            <div className="p-2 bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 rounded-lg">
              <Bell size={20} />
            </div>
            <span>Lịch Sử Cảnh Báo Sự Cố</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle Sound */}
            <button
              onClick={onToggleSound}
              title={soundEnabled ? 'Đang BẬT âm thanh cảnh báo (Bấm để tắt)' : 'Đang TẮT âm thanh cảnh báo (Bấm để bật)'}
              className={`p-1.5 rounded-lg border transition-colors ${
                soundEnabled
                  ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800'
                  : 'bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600'
              }`}
            >
              {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content list */}
        <div className="p-4 overflow-y-auto flex-1 space-y-2.5 divide-y divide-slate-100 dark:divide-slate-700/50">
          {alerts.length === 0 ? (
            <div className="py-12 text-center text-slate-400 dark:text-slate-500">
              <CheckCircle size={36} className="mx-auto mb-2 text-emerald-500 opacity-60" />
              <p className="font-semibold text-slate-700 dark:text-slate-300 text-sm">
                Không có sự cố nào gần đây
              </p>
              <p className="text-xs mt-0.5">Tất cả camera và đầu ghi đang hoạt động ổn định.</p>
            </div>
          ) : (
            alerts.map((a) => {
              const isOffline = a.event_type === 'OFFLINE';
              const utcStr = (a.timestamp || '').endsWith('Z') ? a.timestamp : (a.timestamp || '') + 'Z';
              const d = a.timestamp ? new Date(utcStr) : new Date();

              return (
                <div key={a.id} className="pt-2.5 flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg mt-0.5 flex-shrink-0 ${
                      isOffline
                        ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
                        : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                    }`}
                  >
                    {isOffline ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-800 dark:text-slate-100 text-sm truncate">
                        {a.camera_name || 'Camera'}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums whitespace-nowrap">
                        {d.toLocaleTimeString('vi-VN')} · {d.toLocaleDateString('vi-VN')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                      <span className="font-mono">{a.camera_ip}</span>
                      {a.camera_location && <span>· 📍 {a.camera_location}</span>}
                    </div>

                    <div className="mt-1">
                      {isOffline ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800/60">
                          🔴 Mất tín hiệu / Treo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/60">
                          🟢 Đã khôi phục kết nối
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Tổng cộng: <strong>{alerts.length}</strong> sự cố ghi nhận
          </span>

          <div className="flex items-center gap-2">
            {alerts.length > 0 && (
              <button
                type="button"
                onClick={onClearAlerts}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors border border-rose-200 dark:border-rose-900/60"
              >
                <Trash2 size={13} />
                <span>Xóa Lịch Sử</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors"
            >
              Đóng
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
