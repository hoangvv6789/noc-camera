import React, { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
} from '@tanstack/react-table';
import { Edit2, Check, X, Trash2, Loader2, Terminal, Zap, RefreshCw, Crosshair, Radio, Power } from 'lucide-react';
import StatusBadge from './StatusBadge';

// Định nghĩa width cố định cho từng cột (px)
const COL_WIDTHS = {
  stt:          50,
  status:      140,
  name:        180,
  ip:          125,
  mac_address: 145,
  switch_name: 155,
  switch_ip:   135,
  switch_port: 105,
  latency_ms:   85,
  last_seen_at:145,
  actions:     125,
};

export default function CameraTable({
  data = [],
  isLoading,
  pagination = { page: 1, page_size: 50, total_pages: 1, total_items: 0 },
  onPageChange,
  onPageSizeChange,
  onRenameCamera,
  onDeleteCamera,
  onInspectSwitchPort,
  onPingCamera,
  onToggleStatus,
  onScanCameraMac,
  pingingCameraId = null,
}) {
  const [sorting, setSorting] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [isSaving, setIsSaving] = useState(false);


  const curPage = pagination?.page || 1;
  const curPageSize = pagination?.page_size || 50;
  const totalPages = pagination?.total_pages || 1;
  const totalItems = pagination?.total_items ?? pagination?.total ?? 0;

  const startEdit = (camera) => {
    setEditingId(camera.id);
    setEditingName(camera.name || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
    setIsSaving(false);
  };

  const saveEdit = async (cameraId) => {
    if (!editingName.trim()) {
      cancelEdit();
      return;
    }
    setIsSaving(true);
    try {
      await onRenameCamera(cameraId, editingName.trim());
      setEditingId(null);
    } catch {
      // Giữ nguyên ô input nếu lỗi
    } finally {
      setIsSaving(false);
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
        cell: (info) => {
          const cam = info.row.original;
          const status = info.getValue();
          const isPinging = pingingCameraId === cam.id;
          return (
            <div className="inline-flex items-center gap-1.5">
              <div 
                onClick={() => onToggleStatus?.(cam)}
                className="cursor-pointer transition-transform active:scale-95"
                title={`Bấm để chuyển nhanh trạng thái sang ${status === 'ONLINE' ? 'OFFLINE (Mất kết nối / Dấu X)' : 'ONLINE (Đang kết nối)'}`}
              >
                <StatusBadge status={status} />
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPingCamera?.(cam);
                }}
                disabled={isPinging}
                title="Ping kiểm tra phản hồi mạng trực tiếp"
                className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
              >
                {isPinging ? (
                  <Loader2 size={12} className="animate-spin text-blue-500" />
                ) : (
                  <Radio size={12} />
                )}
              </button>
            </div>
          );
        },
        size: COL_WIDTHS.status,
      },

      {
        accessorKey: 'name',
        header: 'Tên Camera (Bấm ✏️ đổi)',
        cell: (info) => {
          const cam = info.row.original;
          const isCurrentlyEditing = editingId === cam.id;

          if (isCurrentlyEditing) {
            return (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  autoFocus
                  disabled={isSaving}
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(cam.id);
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  className="px-2 py-1 text-xs bg-white dark:bg-slate-900 border-2 border-blue-500 rounded-md focus:outline-none dark:text-white w-36 shadow-sm font-semibold"
                />
                <button
                  type="button"
                  onClick={() => saveEdit(cam.id)}
                  disabled={isSaving}
                  title="Lưu (Enter)"
                  className="p-1 text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors shadow-sm"
                >
                  {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={isSaving}
                  title="Hủy (Esc)"
                  className="p-1 text-slate-500 hover:text-slate-700 bg-slate-200 dark:bg-slate-700 dark:text-slate-300 rounded transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            );
          }

          return (
            <div className="flex items-center justify-between gap-1 group py-0.5">
              <div className="flex flex-col min-w-0">
                <span 
                  className="font-semibold text-slate-800 dark:text-slate-100 truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                  onClick={() => startEdit(cam)}
                  title="Bấm vào để đổi tên camera (tự động đồng bộ sang đầu ghi NVR)"
                >
                  {cam.name || 'N/A'}
                </span>
                {cam.nvr_name && (
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-mono truncate">
                    🎥 {cam.nvr_name} {cam.nvr_channel_id ? `(Kênh ${cam.nvr_channel_id})` : ''}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => startEdit(cam)}
                title="Đổi tên camera & đồng bộ NVR"
                className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded transition-colors opacity-70 hover:opacity-100 flex-shrink-0"
              >
                <Edit2 size={13} />
              </button>
            </div>
          );
        },
        size: COL_WIDTHS.name,
      },
      {
        accessorKey: 'ip',
        header: 'IP Camera',
        cell: (info) => (
          <span className="font-mono text-xs text-slate-700 dark:text-slate-300 font-medium">
            {info.getValue() || '-'}
          </span>
        ),
        size: COL_WIDTHS.ip,
      },
      {
        accessorKey: 'mac_address',
        header: 'Địa Chỉ MAC',
        cell: (info) => (
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
            {info.getValue() || '-'}
          </span>
        ),
        size: COL_WIDTHS.mac_address,
      },
      {
        accessorKey: 'switch_name',
        header: 'Tên Switch',
        cell: (info) => {
          const cam = info.row.original;
          const val = info.getValue();
          if (!val) {
            if (cam.status === 'OFFLINE') {
              return (
                <span 
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40 cursor-help"
                  title="Camera đang mất kết nối / đã tháo về / không cắm mạng nên không có Switch"
                >
                  Tháo về / Chưa cắm
                </span>
              );
            }
            return <span className="text-slate-400">—</span>;
          }
          return (
            <span
              onClick={() => cam.switch_ip && onInspectSwitchPort?.(cam)}
              className={`font-medium text-slate-800 dark:text-slate-200 text-xs ${cam.switch_ip ? 'cursor-pointer hover:text-blue-600 dark:hover:text-blue-400' : ''}`}
              title={cam.switch_ip ? "Bấm để mở SSH kiểm tra Switch này" : undefined}
            >
              {val}
            </span>
          );
        },
        size: COL_WIDTHS.switch_name,
      },
      {
        accessorKey: 'switch_ip',
        header: 'IP Switch (Bấm SSH)',
        cell: (info) => {
          const cam = info.row.original;
          const ip = info.getValue();
          if (!ip) return <span className="text-slate-400">—</span>;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onInspectSwitchPort?.(cam);
              }}
              title={`Bấm để mở SSH chẩn đoán Switch ${ip} (Cổng ${cam.switch_port || 'N/A'})`}
              className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline flex items-center gap-1 font-medium group"
            >
              <span>{ip}</span>
              <Terminal size={12} className="opacity-60 group-hover:opacity-100 transition-opacity" />
            </button>
          );
        },
        size: COL_WIDTHS.switch_ip,
      },
      {
        accessorKey: 'switch_port',
        header: 'Port Kết Nối',
        cell: (info) => {
          const cam = info.row.original;
          const val = info.getValue();
          if (!val || val === 'Unknown') return <span className="text-slate-400">—</span>;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (cam.switch_ip) onInspectSwitchPort?.(cam);
              }}
              title={cam.switch_ip ? `Bấm để kiểm tra chi tiết cổng ${val} trên Switch qua SSH` : undefined}
              className={`font-mono text-xs bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 px-1.5 py-0.5 rounded font-semibold border border-slate-200 dark:border-slate-600 ${cam.switch_ip ? 'hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:border-blue-400 cursor-pointer' : ''}`}
            >
              {val}
            </button>
          );
        },
        size: COL_WIDTHS.switch_port,
      },
      {
        accessorKey: 'latency_ms',
        header: 'Độ Trễ',
        cell: (info) => {
          const val = info.getValue();
          if (val === null || val === undefined) return <span className="text-slate-400">—</span>;
          let color = 'text-green-600 dark:text-green-400';
          if (val > 50) color = 'text-red-500 dark:text-red-400';
          else if (val > 10) color = 'text-yellow-500 dark:text-yellow-400';
          return <span className={`font-semibold tabular-nums ${color}`}>{val.toFixed(1)} ms</span>;
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
          const cam = info.row.original;
          const isPinging = pingingCameraId === cam.id;
          return (
            <div className="flex items-center gap-1 justify-end pr-1">
              {/* Nút Đổi Trạng Thái Thủ Công (ONLINE / OFFLINE) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStatus?.(cam);
                }}
                title={cam.status === 'ONLINE' ? 'Đổi trạng thái sang MẤT KẾT NỐI (Dấu X / OFFLINE)' : 'Đổi trạng thái sang HOẠT ĐỘNG (ONLINE)'}
                className={`p-1 rounded transition-colors ${cam.status === 'ONLINE' ? 'text-emerald-500 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40' : 'text-red-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'}`}
              >
                <Power size={13} />
              </button>

              {/* Nút Ping Thủ Công */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPingCamera?.(cam);
                }}
                disabled={isPinging}
                title="Ping kiểm tra phản hồi camera này ngay"
                className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded transition-colors opacity-80 hover:opacity-100 disabled:opacity-50"
              >
                {isPinging ? <Loader2 size={13} className="animate-spin text-emerald-600" /> : <Radio size={13} />}
              </button>

              {/* Nút Quét MAC Định Vị Switch */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onScanCameraMac?.(cam);
                }}
                title="Quét bảng MAC định vị lại Switch & Cổng cho camera này"
                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded transition-colors opacity-80 hover:opacity-100"
              >
                <Crosshair size={13} />
              </button>

              {/* Nút Mở Terminal SSH Switch */}
              {cam.switch_ip && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onInspectSwitchPort?.(cam);
                  }}
                  title="Mở SSH chẩn đoán cổng Switch"
                  className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded transition-colors opacity-80 hover:opacity-100"
                >
                  <Terminal size={13} />
                </button>
              )}

              {/* Nút Xóa Camera */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteCamera?.(cam.id, cam.name);
                }}
                title="Xóa Camera"
                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded transition-colors opacity-80 hover:opacity-100"
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
    [pagination, editingId, editingName, isSaving, pingingCameraId]
  );


  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
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
              Array.from({ length: 8 }).map((_, i) => (
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
                    <span className="text-3xl">📷</span>
                    <span>Không tìm thấy camera nào. Hãy thêm camera mới hoặc import file CSV.</span>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isOffline = row.original.status === 'OFFLINE';
                return (
                  <tr
                    key={row.id}
                    className={[
                      'hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors',
                      isOffline ? 'bg-red-50 dark:bg-red-950/20' : '',
                    ].join(' ')}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-3 py-2.5 whitespace-nowrap overflow-hidden text-ellipsis"
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
            Tổng <strong>{totalItems}</strong> camera
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

          {/* Hiển thị số trang */}
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
