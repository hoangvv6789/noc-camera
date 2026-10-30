import React, { useState, useEffect } from 'react';
import {
  X,
  Terminal,
  Activity,
  Zap,
  FileText,
  Radio,
  Copy,
  Check,
  Loader2,
  Shield,
  Play,
  RotateCcw,
  Network
} from 'lucide-react';
import { executeSwitchCommand } from '../api/client';

export default function SwitchTerminalModal({ isOpen, onClose, targetSwitch }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');

  const [command, setCommand] = useState('show interfaces status');
  const [terminalOutput, setTerminalOutput] = useState('');
  const [loadingCmd, setLoadingCmd] = useState(false);
  const [copied, setCopied] = useState(false);

  // Danh sách các lệnh Cisco mẫu gợi ý nhanh
  const QUICK_COMMANDS = [
    { label: 'Trạng Thái Cổng', cmd: 'show interfaces status', icon: Activity },
    { label: 'Bảng MAC', cmd: 'show mac address-table', icon: Radio },
    { label: 'Bảng ARP', cmd: 'show ip arp', icon: FileText },
    { label: 'CDP Neighbors', cmd: 'show cdp neighbors detail', icon: Network },
    { label: 'Nguồn PoE', cmd: 'show power inline', icon: Zap },
    { label: 'Thông Tin Switch', cmd: 'show version', icon: FileText },
    { label: 'Cấu Hình Chạy', cmd: 'show running-config', icon: FileText },
  ];

  useEffect(() => {
    if (isOpen && targetSwitch) {
      const savedUser = localStorage.getItem('ssh_username') || 'admin';
      const savedPass = localStorage.getItem('ssh_password') || '';
      const savedSecret = localStorage.getItem('ssh_secret') || '';
      setUsername(savedUser);
      setPassword(savedPass);
      setSecret(savedSecret);

      setTerminalOutput(
        `--- CISCO CLI TERMINAL ---\n` +
        `Switch:   ${targetSwitch.hostname} (${targetSwitch.ip})\n` +
        `Vị Trí:   ${targetSwitch.location || 'N/A'}\n` +
        `Thời gian: ${new Date().toLocaleString('vi-VN')}\n\n` +
        `Sẵn sàng thực thi lệnh chẩn đoán trực tiếp trên Switch Cisco qua SSH.\n` +
        `Chọn lệnh nhanh bên dưới hoặc nhập lệnh tùy chỉnh và nhấn 'Chạy Lệnh'.\n`
      );
      setCommand('show interfaces status');
    }
  }, [isOpen, targetSwitch]);

  if (!isOpen || !targetSwitch) return null;

  const handleRunCommand = async (cmdToRun = command) => {
    if (!username.trim() || !password.trim()) {
      alert('Vui lòng nhập Username và Password SSH của Switch.');
      return;
    }
    if (!cmdToRun.trim()) {
      alert('Vui lòng nhập lệnh thực thi.');
      return;
    }

    // Save creds if user provided
    localStorage.setItem('ssh_username', username.trim());
    if (password.trim()) localStorage.setItem('ssh_password', password.trim());
    if (secret.trim()) localStorage.setItem('ssh_secret', secret.trim());

    setLoadingCmd(true);
    const timestamp = new Date().toLocaleTimeString('vi-VN');
    setTerminalOutput((prev) => prev + `\n\n[${timestamp}] ${targetSwitch.hostname}# ${cmdToRun}\n⏳ Đang kết nối SSH và thực thi...`);

    try {
      const res = await executeSwitchCommand({
        switch_ip: targetSwitch.ip,
        username: username.trim(),
        password: password.trim(),
        secret: secret.trim() || undefined,
        command: cmdToRun.trim(),
      });

      setTerminalOutput((prev) => {
        const clean = prev.replace('⏳ Đang kết nối SSH và thực thi...', '');
        return clean + (res.output || 'Không có dữ liệu trả về.');
      });
    } catch (err) {
      setTerminalOutput((prev) => {
        const clean = prev.replace('⏳ Đang kết nối SSH và thực thi...', '');
        return clean + `\n❌ Lỗi thực thi: ${err.response?.data?.detail || err.message || 'Không thể kết nối SSH.'}`;
      });
    } finally {
      setLoadingCmd(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(terminalOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-sm">
              <Terminal size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Cisco CLI Terminal Console
                </h2>
                <span className="text-xs bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded font-mono font-bold">
                  {targetSwitch.hostname}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  ({targetSwitch.ip})
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Vị trí: <span className="font-semibold text-slate-700 dark:text-slate-200">{targetSwitch.location || 'Chưa thiết lập'}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* SSH Credentials Bar */}
        <div className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-medium">
            <Shield size={14} className="text-indigo-500" />
            Xác thực SSH:
          </div>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white w-32 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <input
            type="password"
            placeholder="Password (bắt buộc)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white w-36 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <input
            type="password"
            placeholder="Secret (tùy chọn)"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white w-32 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-auto hidden sm:flex items-center gap-1">
            🔒 Kết nối trực tiếp qua SSH Port 22
          </span>
        </div>

        {/* Quick Commands Bar */}
        <div className="px-5 py-2 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto flex-nowrap custom-scrollbar">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1 flex-shrink-0">
            Lệnh nhanh:
          </span>
          {QUICK_COMMANDS.map((qc) => {
            const Icon = qc.icon;
            return (
              <button
                key={qc.cmd}
                onClick={() => {
                  setCommand(qc.cmd);
                  handleRunCommand(qc.cmd);
                }}
                disabled={loadingCmd}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 dark:hover:border-indigo-800 transition-colors flex-shrink-0 shadow-2xs"
              >
                <Icon size={12} className="text-indigo-500" />
                {qc.label}
              </button>
            );
          })}
        </div>

        {/* Terminal Body */}
        <div className="flex-1 p-4 flex flex-col gap-3 min-h-0 overflow-hidden bg-slate-950">
          
          {/* Terminal Output */}
          <div className="relative flex-1 bg-slate-900 rounded-xl border border-slate-800 p-4 font-mono text-xs text-slate-200 overflow-auto custom-scrollbar whitespace-pre-wrap leading-relaxed shadow-inner">
            {terminalOutput}

            {/* Action buttons inside terminal */}
            <div className="absolute top-3 right-3 flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-2.5 py-1 bg-slate-800/90 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 text-xs flex items-center gap-1.5 shadow"
                title="Sao chép toàn bộ log"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copied ? 'Đã sao chép' : 'Sao chép'}
              </button>
              <button
                onClick={() => setTerminalOutput(`--- SẴN SÀNG (${targetSwitch.hostname} - ${targetSwitch.ip}) ---`)}
                className="px-2.5 py-1 bg-slate-800/90 hover:bg-slate-700 text-slate-400 rounded border border-slate-700 text-xs flex items-center gap-1"
                title="Xóa màn hình log"
              >
                <RotateCcw size={12} />
                Xóa màn hình
              </button>
            </div>
          </div>

          {/* Command Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRunCommand();
            }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-slate-900 p-3 rounded-xl border border-slate-800 shadow-md"
          >
            <div className="flex items-center gap-2 flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 focus-within:border-indigo-500 transition-colors">
              <span className="font-mono text-xs text-indigo-400 font-bold select-none">
                {targetSwitch.hostname}#
              </span>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Nhập lệnh Cisco (VD: show mac address-table, show run, ping...)"
                className="flex-1 bg-transparent text-emerald-400 font-mono text-xs font-semibold focus:outline-none placeholder-slate-600"
              />
            </div>

            <button
              type="submit"
              disabled={loadingCmd || !command.trim()}
              className="px-5 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors shadow-sm whitespace-nowrap justify-center text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
            >
              {loadingCmd ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Đang gửi lệnh...
                </>
              ) : (
                <>
                  <Play size={14} className="fill-current" />
                  Chạy Lệnh (Enter)
                </>
              )}
            </button>
          </form>

        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Shield size={13} className="text-emerald-500" />
            Hỗ trợ cả chế độ xem (User Exec) và cấu hình (Privileged Exec/Config).
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Đóng
          </button>
        </div>

      </div>
    </div>
  );
}
