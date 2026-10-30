import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  Key,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Database,
  ArrowRight
} from 'lucide-react';
import { fetchCms2Config, testCms2Connection, syncCms2 } from '../api/client';

export default function Cms2SyncModal({ isOpen, onClose, onSyncSuccess }) {
  const [ip, setIp] = useState('172.18.20.200');
  const [port, setPort] = useState(80);
  const [username, setUsername] = useState('Admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saveConfig, setSaveConfig] = useState(true);

  const [savedConfig, setSavedConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      setTestResult(null);
      setSyncResult(null);
      setErrorMsg('');
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      setLoadingConfig(true);
      const data = await fetchCms2Config();
      if (data) {
        setSavedConfig(data);
        if (data.ip) setIp(data.ip);
        if (data.port) setPort(data.port);
        if (data.username) setUsername(data.username);
      }
    } catch (err) {
      console.error('Không thể nạp cấu hình CMS2:', err);
    } finally {
      setLoadingConfig(false);
    }
  };

  const handleTestConnection = async () => {
    setErrorMsg('');
    setTestResult(null);
    setSyncResult(null);
    setTesting(true);

    try {
      const res = await testCms2Connection({
        ip,
        port: parseInt(port) || 80,
        username,
        password,
        save_config: saveConfig
      });
      setTestResult(res);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Lỗi kết nối tới CMS 2.0';
      setErrorMsg(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleStartSync = async () => {
    setErrorMsg('');
    setSyncResult(null);
    setSyncing(true);

    try {
      const res = await syncCms2({
        ip,
        port: parseInt(port) || 80,
        username,
        password,
        save_config: saveConfig
      });
      setSyncResult(res);
      if (onSyncSuccess) {
        onSyncSuccess(res);
      }
      loadConfig();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Đồng bộ thất bại!';
      setErrorMsg(msg);
    } finally {
      setSyncing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden transition-all">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-gradient-to-r from-blue-50/50 via-indigo-50/30 to-transparent dark:from-blue-950/20 dark:via-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Server size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Đồng bộ Camera & Đầu ghi từ CMS 2.0
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Kéo trực tiếp danh sách tập trung từ máy chủ ACTi CMS 2.0
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          
          {/* Thông tin đã lưu gần nhất */}
          {savedConfig && savedConfig.last_synced_at && (
            <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 rounded-xl text-xs flex items-center justify-between text-blue-800 dark:text-blue-300">
              <div className="flex items-center gap-2">
                <Database size={15} className="text-blue-600 dark:text-blue-400" />
                <span>
                  Đã đồng bộ <strong>{savedConfig.synced_cameras}</strong> cam từ CMS 2 ({savedConfig.ip})
                </span>
              </div>
              <span className="text-[11px] text-blue-600/80 dark:text-blue-400/80">
                {new Date(savedConfig.last_synced_at).toLocaleString('vi-VN')}
              </span>
            </div>
          )}

          {/* Form Thông tin CMS2 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Địa chỉ IP Máy chủ CMS 2.0
              </label>
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="172.18.20.200"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="80"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tài khoản (Username)
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Admin"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Mật khẩu (Password)
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={savedConfig?.has_password ? '•••••••• (Đã lưu)' : 'Nhập mật khẩu CMS 2.0'}
                  className="w-full pl-3 pr-9 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>

          {/* Option: Lưu mật khẩu */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="saveCmsConfig"
              checked={saveConfig}
              onChange={(e) => setSaveConfig(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700"
            />
            <label htmlFor="saveCmsConfig" className="text-xs text-slate-600 dark:text-slate-400 select-none">
              Ghi nhớ tài khoản & mật khẩu CMS 2.0 trên hệ thống (không cần nhập lại)
            </label>
          </div>

          {/* Alert Error */}
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{errorMsg}</div>
            </div>
          )}

          {/* Test Kết nối Thành công */}
          {testResult && testResult.success && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2.5">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">{testResult.message}</div>
                {testResult.product_name && (
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                    Hệ thống: {testResult.product_name} {testResult.domain ? `(Domain: ${testResult.domain})` : ''}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Đồng bộ Thành công */}
          {syncResult && syncResult.success && (
            <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 size={18} className="text-emerald-600" />
                Đồng bộ thành công từ CMS 2.0!
              </div>
              <div className="pl-6 text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                <div>• Tổng số camera tìm thấy: <strong>{syncResult.total_cameras}</strong></div>
                <div>• Thêm mới: <strong>{syncResult.cameras_added}</strong> | Cập nhật: <strong>{syncResult.cameras_updated}</strong></div>
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || syncing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {testing ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Kiểm tra kết nối
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={syncing}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handleStartSync}
              disabled={syncing || testing}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50 transition-colors"
            >
              {syncing ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Đang đồng bộ...
                </>
              ) : (
                <>
                  <ArrowRight size={14} />
                  Bắt đầu đồng bộ
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
