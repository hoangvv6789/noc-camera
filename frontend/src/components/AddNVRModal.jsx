import React, { useState, useEffect } from 'react';
import { X, HardDrive, Plus, Save, Loader2, Info, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { createNVR, updateNVR, testNvrCredentials } from '../api/client';


export default function AddNVRModal({ isOpen, onClose, onSuccess, editTarget = null }) {
  const [formData, setFormData] = useState({
    name: '',
    ip: '',
    model: 'ACTi NVR 3.0',
    location: '',
    http_port: 80,
    rtsp_port: 554,
    custom_ports: '',
    username: 'admin',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  const isEditMode = Boolean(editTarget);

  const handleTestConnection = async () => {
    if (!formData.ip.trim()) {
      setError('Vui lòng nhập IP của NVR trước khi kiểm tra.');
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await testNvrCredentials({
        ip: formData.ip.trim(),
        http_port: Number(formData.http_port) || 80,
        username: formData.username.trim() || 'admin',
        password: formData.password,
      });
      setTestResult(res);
    } catch (err) {
      setTestResult({ success: false, message: err.response?.data?.detail || err.message });
    } finally {
      setTesting(false);
    }
  };


  useEffect(() => {
    if (editTarget) {
      setFormData({
        name: editTarget.name || '',
        ip: editTarget.ip || '',
        model: editTarget.model || 'ACTi NVR 3.0',
        location: editTarget.location || '',
        http_port: editTarget.http_port ?? 80,
        rtsp_port: editTarget.rtsp_port ?? 554,
        custom_ports: editTarget.custom_ports || '',
        username: editTarget.username || 'admin',
        password: editTarget.password || '',
      });
    } else {
      setFormData({
        name: '',
        ip: '',
        model: 'ACTi NVR 3.0',
        location: '',
        http_port: 80,
        rtsp_port: 554,
        custom_ports: '',
        username: 'admin',
        password: '',
      });
    }
    setError(null);
    setTestResult(null);
  }, [editTarget, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.ip.trim()) {
      setError('Vui lòng nhập Tên Đầu Ghi NVR và Địa chỉ IP.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = {
        ...formData,
        http_port: Number(formData.http_port) || 80,
        rtsp_port: Number(formData.rtsp_port) || 554,
        service_port: null,
      };

      if (isEditMode) {
        await updateNVR(editTarget.id, payload);
        onSuccess?.(`Đã cập nhật đầu ghi NVR "${formData.name}" thành công!`);
      } else {
        await createNVR(payload);
        onSuccess?.(`Đã thêm đầu ghi NVR "${formData.name}" (${formData.ip}) thành công!`);
      }
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Lỗi khi lưu NVR. Vui lòng kiểm tra lại IP trùng lặp.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center gap-2 text-slate-800 dark:text-white font-semibold text-lg">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-lg">
              <HardDrive size={20} />
            </div>
            {isEditMode ? 'Chỉnh Sửa Đầu Ghi NVR' : 'Thêm Đầu Ghi NVR Mới'}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-sm bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Tên Đầu Ghi NVR <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="VD: NVR-ACTI-SERVER-01"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Địa Chỉ IP <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="VD: 172.19.1.200"
                value={formData.ip}
                onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Model Đầu Ghi
              </label>
              <input
                type="text"
                placeholder="VD: ACTi NVR 3.0 / INR-410"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Vị Trí Đặt Server / Tủ Rack
              </label>
              <input
                type="text"
                placeholder="VD: Phòng Server Tầng 2"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
              />
            </div>
          </div>

          {/* Cấu hình các cổng dịch vụ */}
          <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              <Info size={14} className="text-blue-500" />
              Cấu hình các Cổng Dịch Vụ Giám Sát Treo
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Cổng Web HTTP (Mặc định: 80)
                </label>
                <input
                  type="number"
                  value={formData.http_port}
                  onChange={(e) => setFormData({ ...formData, http_port: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg dark:text-white font-mono"
                  placeholder="80"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  Cổng RTSP Stream (Mặc định: 554)
                </label>
                <input
                  type="number"
                  value={formData.rtsp_port}
                  onChange={(e) => setFormData({ ...formData, rtsp_port: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg dark:text-white font-mono"
                  placeholder="554"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Cổng phụ khác nếu có (phân cách bằng dấu phẩy, VD: 8080, 8899)
              </label>
              <input
                type="text"
                placeholder="VD: 8080, 8899"
                value={formData.custom_ports}
                onChange={(e) => setFormData({ ...formData, custom_ports: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg dark:text-white font-mono"
              />
            </div>
          </div>
          {/* Cấu hình tài khoản NVR để đồng bộ Camera */}
          <div className="bg-blue-50/50 dark:bg-blue-950/20 p-4 rounded-xl border border-blue-200/60 dark:border-blue-800/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wider">
                <HardDrive size={14} className="text-blue-500" />
                Tài Khoản Quản Trị Đầu Ghi (Bắt buộc để đồng bộ Camera)
              </div>

              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="px-2.5 py-1 text-xs font-semibold bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/60 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300 rounded-lg flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                {testing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {testing ? 'Đang thử...' : 'Thử kết nối'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Tài khoản (Username)
                </label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg dark:text-white"
                  placeholder="admin"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Mật khẩu (Password) <span className="text-red-500">*</span> {editTarget?.has_password && <span className="text-emerald-600 dark:text-emerald-400 text-[10px] font-normal">(Đã lưu)</span>}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg dark:text-white"
                  placeholder={editTarget?.has_password ? "•••••••• (Để trống nếu giữ mật khẩu cũ)" : "Nhập mật khẩu NVR..."}
                />
              </div>
            </div>

            {testResult && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-center gap-2 border animate-fadeIn ${
                  testResult.success
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                    : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                }`}
              >
                {testResult.success ? <CheckCircle size={14} className="flex-shrink-0" /> : <AlertCircle size={14} className="flex-shrink-0" />}
                <span>{testResult.message}</span>
              </div>
            )}

            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
              * Mật khẩu được mã hóa an toàn và dùng để tự động kéo danh sách Camera từ NVR.
            </p>
          </div>


          <div className="pt-2 flex justify-end gap-3 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg flex items-center gap-2 shadow-sm transition-colors"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isEditMode ? (
                <Save size={16} />
              ) : (
                <Plus size={16} />
              )}
              {isEditMode ? 'Lưu Thay Đổi' : 'Lưu & Bắt Đầu Giám Sát'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
