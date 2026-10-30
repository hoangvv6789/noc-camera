import React, { useState, useRef } from 'react';
import { X, Upload, FileSpreadsheet, Download, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { importCamerasCsv, importSwitchesCsv, importNvrsCsv } from '../api/client';

export default function ImportModal({ isOpen, onClose, onSuccess, initialTab = 'camera' }) {
  const [activeTab, setActiveTab] = useState(initialTab); // 'camera' | 'nvr' | 'switch'
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  React.useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (!selected.name.endsWith('.csv')) {
        setError('Vui lòng chọn file có định dạng .csv');
        return;
      }
      setFile(selected);
      setError(null);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Vui lòng chọn file CSV trước khi import.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      let res;
      if (activeTab === 'camera') {
        res = await importCamerasCsv(file);
      } else if (activeTab === 'nvr') {
        res = await importNvrsCsv(file);
      } else {
        res = await importSwitchesCsv(file);
      }
      setResult(res);
      onSuccess?.(res.message);
    } catch (err) {
      setError(err.response?.data?.detail || 'Lỗi khi import file. Vui lòng kiểm tra lại định dạng file CSV.');
    } finally {
      setLoading(false);
    }
  };

  const downloadSampleCsv = (type) => {
    let content = '';
    let filename = '';

    if (type === 'camera') {
      content = 'name,ip,mac_address,model,location\n' +
        'FL1 - C01,172.19.1.96,00:0F:7C:15:4D:36,Z92,Tang 1 - Khu A\n' +
        'FL1 - C02,172.19.1.97,00:0F:7C:15:4D:1D,Z92,Tang 1 - Khu B\n' +
        'FL1 - C10,172.19.1.105,00:0F:7C:15:4D:14,Z92,Tang 1 - Lobby\n';
      filename = 'mau_import_camera.csv';
    } else if (type === 'nvr') {
      content = 'name,ip,model,location,http_port,rtsp_port,custom_ports\n' +
        'NVR-ACTI-Z1,172.19.1.201,ACTi NVR 3.0,Server Room Z1,80,554,\n' +
        'NVR-ACTI-Z2,172.19.1.202,ACTi INR-410,Server Room Z2,80,554,8080\n';
      filename = 'mau_import_nvr.csv';
    } else {
      content = 'ip,hostname,community_string,snmp_version,location\n' +
        '172.19.4.12,BVAS-CAM-Z1T1-R01,bvhn123,v2c,Phong Server Z1\n' +
        '172.19.4.29,BVAS-CAM-Z3T1-R01,bvhn123,v2c,Phong Server Z3\n';
      filename = 'mau_import_switch.csv';
    }

    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const resetState = () => {
    setFile(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center gap-2 text-slate-800 dark:text-white font-semibold text-lg">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-lg">
              <FileSpreadsheet size={20} />
            </div>
            Import Dữ Liệu Từ File CSV
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-100/50 dark:bg-slate-900/40 px-6 pt-3 gap-2">
          <button
            onClick={() => { setActiveTab('camera'); resetState(); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 rounded-t-lg transition-colors ${
              activeTab === 'camera'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            📷 Import Camera
          </button>
          <button
            onClick={() => { setActiveTab('nvr'); resetState(); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 rounded-t-lg transition-colors ${
              activeTab === 'nvr'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 bg-white dark:bg-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            📼 Import Đầu Ghi NVR
          </button>
          <button
            onClick={() => { setActiveTab('switch'); resetState(); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 rounded-t-lg transition-colors ${
              activeTab === 'switch'
                ? 'border-amber-600 text-amber-600 dark:text-amber-400 bg-white dark:bg-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            🖧 Import Switch
          </button>
        </div>


        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Template Download Guide */}
          <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-white mb-0.5">
                Cột bắt buộc: <span className="font-mono text-blue-600 dark:text-blue-400">{activeTab === 'camera' ? 'name, ip' : 'ip, hostname'}</span>
              </p>
              <p>Chưa có file mẫu? Tải file CSV chuẩn tại đây:</p>
            </div>
            <button
              onClick={() => downloadSampleCsv(activeTab)}
              className="px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Download size={14} />
              Tải file mẫu
            </button>
          </div>

          {/* File Drag/Select Area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              file
                ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
                : 'border-slate-300 dark:border-slate-600 hover:border-blue-500 hover:bg-slate-50 dark:hover:bg-slate-900/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-2">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">
                <Upload size={24} />
              </div>
              {file ? (
                <div>
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    {file.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    ({(file.size / 1024).toFixed(1)} KB) - Nhấn để chọn file khác
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Nhấn vào đây để chọn file CSV
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    Định dạng .csv (UTF-8)
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 text-sm bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Result */}
          {result && (
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-1.5">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold text-sm">
                <CheckCircle2 size={18} />
                {result.message}
              </div>
              <div className="text-xs text-emerald-600 dark:text-emerald-400/90 flex gap-4">
                <span>✅ Thêm mới: <strong>{result.added}</strong></span>
                <span>⚠️ Bỏ qua (IP trùng): <strong>{result.skipped}</strong></span>
                <span>❌ Lỗi: <strong>{result.errors?.length || 0}</strong></span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="pt-3 flex justify-end gap-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || loading}
              className="px-5 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg flex items-center gap-2 shadow-sm transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              Bắt Đầu Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
