import React, { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
} from '@tanstack/react-table';
import { Edit2, Trash2, RefreshCw, Loader2, HardDrive, Info, Zap } from 'lucide-react';
import StatusBadge from './StatusBadge';

const COL_WIDTHS = {
  stt: 45,
  status: 135,
  name: 180,
  ip: 120,
  model: 120,
  services: 240,
  latency_ms: 80,
  last_seen_at: 140,
  actions: 210,
};

function PortBadge({ name, port, alive, latency_ms, error }) {
  let badgeColor = 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
  let dotColor = 'bg-slate-400';

  if (alive === true) {
    badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700/60';
    dotColor = 'bg-emerald-500';
  } else if (alive === false) {
    badgeColor = 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-700/60';
    dotColor = 'bg-rose-500 animate-pulse';
  }

  const tooltip = error ? `${name} (Port ${port}): ${error}` : `${name} (Port ${port}): ${latency_ms ? `${latency_ms}ms` : 'OK'}`;

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono border font-medium cursor-help transition-all ${badgeColor}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span>{name.split(' ')[0]}:{port}</span>
      {alive === true && latency_ms && <span className="text-[10px] opacity-75">{latency_ms}ms</span>}
    </span>
  );
}

export default function NVRTable({
  data = [],
  isLoading,
  pagination = { page: 1, page_size: 50, total_pages: 1, total_items: 0 },
  onPageChange,
  onPageSizeChange,
  onEditNVR,
  onDeleteNVR,
  onScanSingleNVR,
  onSyncCameras,
}) {
  const [sorting, setSorting] = useState([]);
  const [scanningId, setScanningId] = useState(null);
  const [syncingId, setSyncingId] = useState(null);

  const curPage = pagination?.page || 1;
  const curPageSize = pagination?.page_size || 50;
  const totalPages = pagination?.total_pages || 1;
  const totalItems = pagination?.total_items ?? pagination?.total ?? 0;

  const handleScanSingle = async (nvrId) => {
    setScanningId(nvrId);
    try {
      await onScanSingleNVR?.(nvrId);
    } finally {
      setScanningId(null);
    }
  };

  const handleSyncCameras = async (nvrId) => {
    setSyncingId(nvrId);
    try {
      await onSyncCameras?.(nvrId);
    } finally {
      setSyncingId(null);
    }
  };

  const columns = React.useMemo(
    () => [
      {
        id: 'stt',
        header: '#',
        cell: (info) => (curPage - 1) * curPageSize + info.row.index + 1,
        size: COL_WIDTHS.stt,
        enableSorting: false,
      },
      {
        accessorKey: 'status',
        header: 'Trạng Thái',
        cell: (info) => <StatusBadge status={info.getValue()} />,
        size: COL_WIDTHS.status,
      },
      {
        accessorKey: 'name',
        header: 'Tên Đầu Ghi NVR',
        cell: (info) => {
          const nvr = info.row.original;
          return (
            <div className="flex flex-col py-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-slate-800 dark:text-slate-100 truncate">
                  {nvr.name || 'N/A'}
                </span>
                {nvr.synced_camera_count > 0 && (
                  <span
                    title={`Đã đồng bộ ${nvr.synced_camera_count} camera từ đầu ghi này`}
                    className="px-1.5 py-0.2 text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-full font-mono"
                  >
                    🎥 {nvr.synced_camera_count} Cam
                  </span>
                )}
                {!nvr.has_password && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditNVR?.(nvr);
                    }}
                    title="Chưa lưu mật khẩu NVR. Bấm vào đây để nhập mật khẩu đồng bộ camera."
                    className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60 rounded cursor-pointer hover:bg-amber-200 transition-colors"
                  >
                    ⚠️ Chưa có MK
                  </span>
                )}
              </div>

              {nvr.location && (
                <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  📍 {nvr.location}
                </span>
              )}
            </div>
          );
        },
        size: COL_WIDTHS.name,
      },
      {
        accessorKey: 'ip',
        header: 'Địa Chỉ IP',
        cell: (info) => (
          <span className="font-mono text-xs text-slate-700 dark:text-slate-300 font-semibold">
            {info.getValue() || '-'}
          </span>
        ),
        size: COL_WIDTHS.ip,
      },
      {
        accessorKey: 'model',
        header: 'Model',
        cell: (info) => (
          <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
            {info.getValue() || 'ACTi NVR'}
          </span>
        ),
        size: COL_WIDTHS.model,
      },
      {
        id: 'services',
        header: 'Chi Tiết Dịch Vụ Giám Sát',
        cell: (info) => {
          const nvr = info.row.original;
          let parsedDetail = null;
          try {
            if (nvr.service_status_detail) {
              parsedDetail = JSON.parse(nvr.service_status_detail);
            }
          } catch (e) {
            // ignore
          }

          const portResults = parsedDetail?.ports || [];

          if (portResults.length === 0) {
            return (
              <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                <PortBadge name="HTTP" port={nvr.http_port || 80} />
                <PortBadge name="RTSP" port={nvr.rtsp_port || 554} />
                {nvr.service_port && <PortBadge name="ACTi" port={nvr.service_port} />}
              </div>
            );
          }

          return (
            <div className="flex flex-wrap items-center gap-1.5 py-0.5">
              {portResults.map((p, idx) => (
                <PortBadge
                  key={idx}
                  name={p.name}
                  port={p.port}
                  alive={p.alive}
                  latency_ms={p.latency_ms}
                  error={p.error}
                />
              ))}
            </div>
          );
        },
        size: COL_WIDTHS.services,
      },
      {
        accessorKey: 'latency_ms',
        header: 'Ping Latency',
        cell: (info) => {
          const val = info.getValue();
          if (val === null || val === undefined) return <span className="text-slate-400">—</span>;
          let color = 'text-green-600 dark:text-green-400';
          if (val > 50) color = 'text-red-500 dark:text-red-400';
          else if (val > 10) color = 'text-yellow-500 dark:text-yellow-400';
          return <span className={`font-semibold tabular-nums text-xs ${color}`}>{val.toFixed(1)} ms</span>;
        },
        size: COL_WIDTHS.latency_ms,
      },
      {
        accessorKey: 'last_seen_at',
        header: 'Lần Cuối Thấy',
        cell: (info) => {
          const val = info.getValue();
          if (!val) return <span className="text-slate-400">—</span>;
          const utcStr = val.endsWith('Z') ? val : val + 'Z';
          const d = new Date(utcStr);
          return (
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {d.toLocaleDateString('vi-VN')} {d.toLocaleTimeString('vi-VN')}
            </span>
          );
        },
        size: COL_WIDTHS.last_seen_at,
      },
      {
        id: 'actions',
        header: 'Thao Tác',
        cell: (info) => {
          const nvr = info.row.original;
          const isScanningThis = scanningId === nvr.id;
          const isSyncingThis = syncingId === nvr.id;

          return (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (!nvr.has_password) {
                    onEditNVR?.(nvr);
                    return;
                  }
                  handleSyncCameras(nvr.id);
                }}
                disabled={isSyncingThis}
                title={nvr.has_password ? "Đồng bộ danh sách Camera từ đầu ghi NVR này vào Dashboard" : "Bấm để nhập mật khẩu NVR trước khi đồng bộ"}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg shadow-sm transition-all disabled:opacity-50 ${
                  nvr.has_password
                    ? 'text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500'
                    : 'text-amber-900 bg-amber-200 hover:bg-amber-300 dark:bg-amber-900/60 dark:text-amber-200 dark:hover:bg-amber-800'
                }`}
              >
                {isSyncingThis ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                <span>{nvr.has_password ? 'Đồng Bộ Cam' : 'Nhập MK & Đồng Bộ'}</span>
              </button>


              <button
                type="button"
                onClick={() => handleScanSingle(nvr.id)}
                disabled={isScanningThis}
                title="Quét kiểm tra dịch vụ NVR này ngay"
                className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition-colors disabled:opacity-50 border border-slate-200 dark:border-slate-700"
              >
                {isScanningThis ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              </button>
              <button
                type="button"
                onClick={() => onEditNVR?.(nvr)}
                title="Sửa cấu hình & mật khẩu NVR"
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors border border-slate-200 dark:border-slate-700"
              >
                <Edit2 size={13} />
              </button>
              <button
                type="button"
                onClick={() => onDeleteNVR?.(nvr.id, nvr.name)}
                title="Xóa đầu ghi NVR"
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors border border-slate-200 dark:border-slate-700"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        },
        size: COL_WIDTHS.actions,
        enableSorting: false,
      },
    ],
    [pagination, scanningId, syncingId]
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows } = table.getRowModel();
  const totalWidth = Object.values(COL_WIDTHS).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col">
      <div className="overflow-auto custom-scrollbar" style={{ maxHeight: '68vh' }}>
        <table
          style={{ width: totalWidth, minWidth: '100%', tableLayout: 'fixed' }}
          className="text-sm text-left"
        >
          <colgroup>
            {columns.map((col) => (
              <col key={col.id ?? col.accessorKey} style={{ width: col.size }} />
            ))}
          </colgroup>

          <thead className="text-xs text-slate-500 dark:text-slate-400 uppercase bg-slate-50 dark:bg-slate-900/60 sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-3 font-semibold whitespace-nowrap select-none border-b border-slate-200 dark:border-slate-700"
                    style={{ width: header.column.getSize() }}
                    onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                  >
                    <div className={`flex items-center gap-1 ${header.column.getCanSort() ? 'cursor-pointer hover:text-slate-700 dark:hover:text-slate-200' : ''}`}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && <span>↑</span>}
                      {header.column.getIsSorted() === 'desc' && <span>↓</span>}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.id ?? col.accessorKey} className="px-3 py-3">
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-16 text-center text-slate-400 dark:text-slate-500"
                >
                  <div className="flex flex-col items-center gap-2">
                    <HardDrive size={36} className="text-slate-300 dark:text-slate-600" />
                    <span className="font-semibold text-slate-600 dark:text-slate-300">
                      Chưa có đầu ghi NVR nào trong hệ thống.
                    </span>
                    <span className="text-xs">
                      Hãy nhấn nút "Thêm NVR" hoặc "Import CSV" để thêm và bắt đầu giám sát treo dịch vụ.
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const nvrStatus = row.original.status;
                let rowBg = '';
                if (nvrStatus === 'SERVICE_FROZEN') {
                  rowBg = 'bg-amber-50/70 dark:bg-amber-950/20';
                } else if (nvrStatus === 'OFFLINE') {
                  rowBg = 'bg-red-50 dark:bg-red-950/20';
                }

                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors ${rowBg}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-3 py-3 whitespace-nowrap overflow-hidden text-ellipsis"
                        style={{ width: cell.column.getSize(), maxWidth: cell.column.getSize() }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          <span>
            Trang <strong>{curPage}</strong> / {Math.max(1, totalPages)}
            &nbsp;·&nbsp;
            Tổng <strong>{totalItems}</strong> đầu ghi NVR
          </span>

          <div className="flex items-center gap-1.5 ml-2 border-l border-slate-200 dark:border-slate-700 pl-3">
            <span className="text-xs">Hiển thị:</span>
            <select
              value={curPageSize}
              onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
              className="py-1 px-2 text-xs border border-slate-300 dark:border-slate-600 rounded-md bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value={10}>10 dòng</option>
              <option value={25}>25 dòng</option>
              <option value={50}>50 dòng</option>
              <option value={100}>100 dòng</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPageChange?.(curPage - 1)}
            disabled={curPage <= 1}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 transition-colors"
          >
            ← Trước
          </button>

          {Array.from({ length: Math.min(5, Math.max(1, totalPages)) }, (_, i) => {
            const pageNum = i + 1;
            const isActive = pageNum === curPage;
            return (
              <button
                key={pageNum}
                onClick={() => onPageChange?.(pageNum)}
                className={`w-7 h-7 text-xs font-semibold rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {pageNum}
              </button>
            );
          })}

          <button
            onClick={() => onPageChange?.(curPage + 1)}
            disabled={curPage >= Math.max(1, totalPages)}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-700 dark:text-slate-200 transition-colors"
          >
            Sau →
          </button>
        </div>
      </div>
    </div>
  );
}
