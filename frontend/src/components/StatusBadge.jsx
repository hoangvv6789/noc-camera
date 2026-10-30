import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default function StatusBadge({ status }) {
  if (status === 'ONLINE') {
    return (
      <span className="status-badge-online">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-green" />
        Hoạt Động
      </span>
    );
  }
  
  if (status === 'SERVICE_FROZEN') {
    return (
      <span className="status-badge-frozen" title="Ping IP thành công nhưng cổng dịch vụ (Web/RTSP/ACTi) không phản hồi hoặc timeout">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        ⚠️ Treo Dịch Vụ
      </span>
    );
  }

  if (status === 'OFFLINE') {
    return (
      <span className="status-badge-offline">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse-red" />
        Mất Kết Nối
      </span>
    );
  }

  
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      Không Rõ
    </span>
  );
}
