import React, { useState, useEffect } from 'react';
import { X, Network, Plus, Check, Loader2 } from 'lucide-react';
import { createSwitch, updateSwitch } from '../api/client';

export default function AddSwitchModal({ isOpen, onClose, onSuccess, editTarget = null }) {
  const [formData, setFormData] = useState({
    hostname: '',
    ip: '',
    community_string: 'bvhn123',
    snmp_version: 'v2c',
    location: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (editTarget) {
      setFormData({
        hostname: editTarget.hostname || '',
        ip: editTarget.ip || '',
        community_string: editTarget.community_string || 'bvhn123',
        snmp_version: editTarget.snmp_version || 'v2c',
        location: editTarget.location || '',
      });
    } else {
      setFormData({
        hostname: '',
        ip: '',
        community_string: 'bvhn123',
        snmp_version: 'v2c',
        location: '',
      });
    }
    setError(null);
  }, [isOpen, editTarget]);

  if (!isOpen) return null;

  const isEdit = Boolean(editTarget);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.hostname.trim() || !formData.ip.trim()) {
      setError('Vui lòng nhập Tên Hostname và Địa chỉ IP Switch.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (isEdit) {
        await updateSwitch(editTarget.id, formData);
        onSuccess?.(`Đã cập nhật Switch "${formData.hostname}" (${formData.ip}) thành công!`);
      } else {
        await createSwitch(formData);
        onSuccess?.(`Đã thêm Switch "${formData.hostname}" (${formData.ip}) thành công!`);
      }
      onClose();
      if (!isEdit) {
        setFormData({ hostname: '', ip: '', community_string: 'bvhn123', snmp_version: 'v2c', location: '' });
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Lỗi khi lưu Switch. Vui lòng kiểm tra lại thông tin.');
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
            <div className="p-2 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-lg">
              <Network size={20} />
            </div>
            {isEdit ? `Chỉnh Sửa Switch: ${editTarget.hostname}` : 'Thêm Switch Mới'}
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
                Tên Hostname <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="VD: BVAS-CAM-Z2T1-R01"
                value={formData.hostname}
                onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-white"
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Địa Chỉ IP <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="VD: 172.19.4.15"
                value={formData.ip}
                onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-white font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                SNMP Community
              </label>
              <input
                type="text"
                placeholder="VD: bvhn123 hoặc public"
                value={formData.community_string}
                onChange={(e) => setFormData({ ...formData, community_string: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-white font-mono"
              />
            </div>

            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                SNMP Version
              </label>
              <select
                value={formData.snmp_version}
                onChange={(e) => setFormData({ ...formData, snmp_version: e.target.value })}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-white"
              >
                <option value="v2c">SNMP v2c (Phổ biến nhất)</option>
                <option value="v1">SNMP v1</option>
                <option value="v3">SNMP v3</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Vị Trí Đặt Switch
            </label>
            <input
              type="text"
              placeholder="VD: Phòng Server Tầng 1"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="w-full px-3.5 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 dark:text-white"
            />
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
              className="px-5 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg flex items-center gap-2 shadow-sm transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : isEdit ? <Check size={16} /> : <Plus size={16} />}
              {isEdit ? 'Lưu Thay Đổi' : 'Lưu Switch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
