import React, { useState, useEffect } from 'react';
import { X, KeyRound, RefreshCw, ShieldCheck, Loader2, Camera as CameraIcon, Network } from 'lucide-react';
import { triggerSshScan, scanSingleCameraMac, scanSwitchMac } from '../api/client';

export default function SshScanModal({ isOpen, onClose, onSuccess, targetCamera = null, targetSwitch = null }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('ssh_username') || '';
    const savedPass = localStorage.getItem('ssh_password') || '';
    const savedSecret = localStorage.getItem('ssh_secret') || '';
    if (savedUser) setUsername(savedUser);
    if (savedPass) setPassword(savedPass);
    if (savedSecret) setSecret(savedSecret);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Vui lòng nhập Username và Password SSH của Switch.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (remember) {
        localStorage.setItem('ssh_username', username);
        localStorage.setItem('ssh_password', password);
        if (secret) localStorage.setItem('ssh_secret', secret);
      }

      let res;
      if (targetCamera) {
        res = await scanSingleCameraMac(targetCamera.id, {
          username,
          password,
          secret: secret || undefined,
        });
      } else if (targetSwitch) {
        res = await scanSwitchMac(targetSwitch.id, {
          username,
          password,
          secret: secret || undefined,
        });
      } else {
        res = await triggerSshScan({
          username,
          password,
          secret: secret || undefined,
        });
      }

      onSuccess?.(res.message || 'Đã thực hiện quét MAC qua SSH thành công!');
      onClose();
    } catch (err) {
      setError(err.response?.data?.detail || 'Lỗi khi kích hoạt quét SSH. Vui lòng kiểm tra lại kết nối.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center gap-2 text-slate-800 dark:text-white font-semibold text-lg">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-lg">
              {targetCamera ? <CameraIcon size={20} /> : targetSwitch ? <Network size={20} /> : <KeyRound size={20} />}
            </div>
            {targetCamera
              ? 'Quét Định Vị Switch Cho Camera'
              : targetSwitch
              ? `Quét Bảng MAC: ${targetSwitch.hostname}`
              : 'Quét MAC Toàn Bộ Switch'}
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
          {targetCamera && (
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl">
              <div className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                🎥 Camera mục tiêu: <span className="font-bold">{targetCamera.name}</span>
              </div>
              <div className="text-[11px] text-indigo-700 dark:text-indigo-300 font-mono mt-0.5 flex items-center gap-3">
                <span>IP: {targetCamera.ip}</span>
                <span>MAC: {targetCamera.mac_address || '(Tự động tìm)'}</span>
              </div>
            </div>
          )}

          {targetSwitch && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl space-y-1">
              <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                ⚡ Quét riêng Switch: <span className="font-bold">{targetSwitch.hostname}</span> ({targetSwitch.camera_count || 0} Camera)
              </div>
              <div className="text-[11px] text-amber-700 dark:text-amber-300 font-mono flex items-center gap-3">
                <span>IP: {targetSwitch.ip}</span>
                <span>Vị trí: {targetSwitch.location || 'N/A'}</span>
              </div>
              <div className="text-[11px] text-amber-800 dark:text-amber-300/90 pt-1 border-t border-amber-200 dark:border-amber-800">
                ⚠️ <i>Lưu ý: Bạn đang quét riêng Switch này ({targetSwitch.camera_count || 0} cam). Để quét toàn bộ 1.630 camera trên tất cả 60 switch, vui lòng đóng bảng này và chọn nút "Quét MAC Toàn Bộ Switch".</i>
              </div>
            </div>
          )}

          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-xs rounded-xl flex items-start gap-2 border border-blue-200 dark:border-blue-800/50">
            <ShieldCheck size={16} className="flex-shrink-0 mt-0.5" />
            <span>
              {targetCamera
                ? 'Hệ thống sẽ tra cứu bảng MAC trên các Switch để tìm chính xác Switch và Port mà Camera này đang cắm vào.'
                : targetSwitch
                ? `Hệ thống sẽ kết nối SSH vào Switch ${targetSwitch.hostname}, đọc bảng MAC & ARP, và cập nhật vị trí cổng cho các camera cắm trên Switch này.`
                : 'Hệ thống quét song song toàn bộ 60 switch qua SSH (Read-Only), tự động loại trừ cổng Trunk/Uplink và định vị chính xác cổng Access cho 1.630 camera.'}
            </span>
          </div>

          {error && (
            <div className="p-3 text-sm bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Username SSH <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="VD: admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Password SSH <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required
              placeholder="Nhập mật khẩu SSH của Switch"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Enable Password (Tùy chọn)
            </label>
            <input
              type="password"
              placeholder="Nếu switch yêu cầu enable secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="remember_ssh"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="remember_ssh" className="text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              Ghi nhớ thông tin đăng nhập trên trình duyệt
            </label>
          </div>

          <div className="pt-3 flex justify-end gap-3 border-t border-slate-200 dark:border-slate-700">
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
              className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg flex items-center gap-2 shadow-sm transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {targetCamera ? 'Bắt Đầu Tìm Port' : targetSwitch ? 'Bắt Đầu Quét Switch' : 'Bắt Đầu Quét MAC'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
