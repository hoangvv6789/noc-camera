import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Terminal,
  Activity,
  Zap,
  FileText,
  Radio,
  RotateCw,
  Copy,
  Check,
  Loader2,
  Shield,
  Play,
  Lock,
  Clock,
  AlertTriangle
} from 'lucide-react';
import { executeSwitchCommand, resetSwitchPort } from '../api/client';

export default function SwitchPortModal({ isOpen, onClose, target }) {
  // target: { switch_name, switch_ip, switch_port, name, ip }
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');

  const [selectedAction, setSelectedAction] = useState('status'); // 'status' | 'mac' | 'config' | 'power' | 'ping' | 'reset'
  const [delaySeconds, setDelaySeconds] = useState(15); // 15s to 30s
  const [terminalOutput, setTerminalOutput] = useState('');
  const [loadingCmd, setLoadingCmd] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [copied, setCopied] = useState(false);

  const port = target?.switch_port || 'Gi1/0/1';
  const camIp = target?.ip || target?.camera_ip || '';
  const camName = target?.name || target?.camera_name || 'N/A';

  // Định nghĩa các lệnh cố định tương ứng từng action
  const getCommandText = () => {
    switch (selectedAction) {
      case 'status':
        return `show interfaces ${port} status`;
      case 'mac':
        return `show mac address-table interface ${port}`;
      case 'config':
        return `show running-config interface ${port}`;
      case 'power':
        return `show power inline ${port}`;
      case 'ping':
        return camIp ? `ping ${camIp}` : `ping 172.19.1.1`;
      case 'reset':
        return `configure terminal\ninterface ${port}\nshutdown\n! [Tự động tạm dừng ${delaySeconds}s để xả hết nguồn PoE / ngắt hẳn camera]\nno shutdown\nend`;
      default:
        return `show interfaces ${port} status`;
    }
  };

  useEffect(() => {
    if (isOpen) {
      // Xóa mật khẩu cũ trong localStorage để bảo mật tối đa
      localStorage.removeItem('ssh_password');
      localStorage.removeItem('ssh_secret');
      setSelectedAction('status');
      setDelaySeconds(15);

      const p = target?.switch_port || 'Gi1/0/1';
      setTerminalOutput(
        `--- CHẨN ĐOÁN & ĐIỀU KHIỂN CỔNG SWITCH QUA SSH ---\n` +
        `Switch:  ${target?.switch_name || 'N/A'} (${target?.switch_ip || 'Chưa có IP'})\n` +
        `Cổng:    ${p}\n` +
        `Camera:  ${camName} ${camIp ? `(IP: ${camIp})` : ''}\n\n` +
        `🔒 Chế độ an toàn: Các lệnh đều được cố định chuẩn mẫu (Chỉ xem - Không cho phép chỉnh sửa nhằm tránh lỗi Switch).\n` +
        `⚡ Lệnh Reset Cổng: Tự động shutdown -> đợi 15-30s xả hết nguồn PoE -> no shutdown bật lại.`
      );
    }
  }, [isOpen, target, camName, camIp]);

  if (!isOpen || !target) return null;

  const handleExecute = async (e) => {
    if (e) e.preventDefault();

    if (!username.trim() || !password.trim()) {
      alert('Vui lòng nhập Username và Password SSH của Switch.');
      return;
    }
    if (!target.switch_ip) {
      alert('Không tìm thấy IP của Switch.');
      return;
    }

    setLoadingCmd(true);
    const timestamp = new Date().toLocaleTimeString('vi-VN');

    if (selectedAction === 'reset') {
      // Chu trình Reset Cổng với thời gian chờ 15s - 30s
      setTerminalOutput(prev => prev + `\n\n[${timestamp}] ${target.switch_ip}# [CHU TRÌNH RESET CỔNG ${port} (Đợi ${delaySeconds}s)]\n⏳ [1/3] Đang kết nối SSH và gửi lệnh shutdown cổng...`);

      // Bắt đầu đếm ngược hiển thị trên giao diện
      setCountdown(delaySeconds);
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      try {
        const res = await resetSwitchPort({
          switch_ip: target.switch_ip,
          username: username.trim(),
          password: password.trim(),
          secret: secret.trim() || undefined,
          port: port,
          delay_seconds: delaySeconds,
        });

        clearInterval(timer);
        setCountdown(0);
        setTerminalOutput(prev => {
          const clean = prev.replace('⏳ [1/3] Đang kết nối SSH và gửi lệnh shutdown cổng...', '');
          return clean + `\n${res.output || 'Không có kết quả trả về.'}`;
        });
      } catch (err) {
        clearInterval(timer);
        setCountdown(0);
        setTerminalOutput(prev => {
          const clean = prev.replace('⏳ [1/3] Đang kết nối SSH và gửi lệnh shutdown cổng...', '');
          return clean + `\n❌ Lỗi khi Reset Cổng: ${err.response?.data?.detail || err.message || 'Không thể kết nối SSH.'}`;
        });
      } finally {
        setLoadingCmd(false);
      }
    } else {
      // Các lệnh show / ping thông thường
      const cmdToRun = getCommandText();
      setTerminalOutput(prev => prev + `\n\n[${timestamp}] ${target.switch_ip}# ${cmdToRun}\n⏳ Đang thực thi lệnh...`);

      try {
        const res = await executeSwitchCommand({
          switch_ip: target.switch_ip,
          username: username.trim(),
          password: password.trim(),
          secret: secret.trim() || undefined,
          command: cmdToRun,
        });

        setTerminalOutput(prev => {
          const clean = prev.replace('⏳ Đang thực thi lệnh...', '');
          return clean + (res.output || 'Không có kết quả trả về.');
        });
      } catch (err) {
        setTerminalOutput(prev => {
          const clean = prev.replace('⏳ Đang thực thi lệnh...', '');
          return clean + `\n❌ Lỗi thực thi: ${err.response?.data?.detail || err.message || 'Không thể kết nối SSH.'}`;
        });
      } finally {
        setLoadingCmd(false);
      }
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(terminalOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 text-white rounded-xl shadow-sm">
              <Terminal size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Kiểm Tra & Điều Khiển Cổng Switch: <span className="text-blue-600 dark:text-blue-400 font-mono">{port}</span>
                </h2>
                <span className="text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded font-mono font-medium">
                  {target.switch_name} ({target.switch_ip})
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Camera: <span className="font-semibold text-slate-700 dark:text-slate-200">{camName}</span> {camIp ? `(IP: ${camIp})` : ''}
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
            <Shield size={14} className="text-blue-500" />
            Xác thực SSH:
          </div>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white w-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="password"
            placeholder="Password (bắt buộc)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white w-36 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="password"
            placeholder="Secret (tùy chọn)"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white w-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-auto flex items-center gap-1">
            🔒 Mật khẩu an toàn trong phiên làm việc
          </span>
        </div>

        {/* Main Body */}
        <div className="flex-1 p-4 flex flex-col gap-3 min-h-0 overflow-hidden bg-slate-950">
          
          {/* Action Selector 1, 2, 3, 4, 5, 6 */}
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-300 font-semibold flex items-center gap-1.5">
                <FileText size={13} className="text-blue-400" />
                Chọn tác vụ chẩn đoán / điều khiển:
              </span>
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Lock size={12} className="text-amber-400" />
                Lệnh chuẩn mẫu (Chỉ xem - Không cho sửa)
              </span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar flex-nowrap pb-0.5">
              <button
                type="button"
                onClick={() => setSelectedAction('status')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border flex-shrink-0 whitespace-nowrap ${selectedAction === 'status' ? 'bg-blue-600 text-white border-blue-500 shadow' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'}`}
                title="Xem trạng thái cắm dây, tốc độ, VLAN của cổng"
              >
                <Activity size={13} className="text-emerald-400" />
                1. Trạng Thái Cổng
              </button>

              <button
                type="button"
                onClick={() => setSelectedAction('mac')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border flex-shrink-0 whitespace-nowrap ${selectedAction === 'mac' ? 'bg-blue-600 text-white border-blue-500 shadow' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'}`}
                title="Xem tất cả địa chỉ MAC đang nhận trên cổng"
              >
                <Radio size={13} className="text-blue-400" />
                2. Bảng MAC
              </button>

              <button
                type="button"
                onClick={() => setSelectedAction('config')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border flex-shrink-0 whitespace-nowrap ${selectedAction === 'config' ? 'bg-blue-600 text-white border-blue-500 shadow' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'}`}
                title="Xem cấu hình chi tiết của cổng"
              >
                <FileText size={13} className="text-amber-400" />
                3. Cấu Hình
              </button>

              <button
                type="button"
                onClick={() => setSelectedAction('power')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border flex-shrink-0 whitespace-nowrap ${selectedAction === 'power' ? 'bg-blue-600 text-white border-blue-500 shadow' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'}`}
                title="Kiểm tra nguồn cấp PoE cấp cho camera"
              >
                <Zap size={13} className="text-yellow-400" />
                4. Nguồn PoE
              </button>

              <button
                type="button"
                onClick={() => setSelectedAction('ping')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border flex-shrink-0 whitespace-nowrap ${selectedAction === 'ping' ? 'bg-blue-600 text-white border-blue-500 shadow' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'}`}
                title={camIp ? `Ping trực tiếp từ Switch tới Camera (${camIp})` : 'Ping tới Camera'}
              >
                <Radio size={13} className="text-indigo-400" />
                5. Ping Cam
              </button>

              <button
                type="button"
                onClick={() => setSelectedAction('reset')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors border flex-shrink-0 whitespace-nowrap ${selectedAction === 'reset' ? 'bg-rose-700 text-white border-rose-600 shadow-md ring-2 ring-rose-500/30' : 'bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border-rose-800/80'}`}
                title="Tắt cổng, tạm dừng 15-30 giây xả nguồn PoE, sau đó bật lại"
              >
                <RotateCw size={13} />
                6. Reset Cổng (Reboot Cam)
              </button>
            </div>

            {/* Cấu hình thời gian chờ riêng cho tác vụ Reset Cổng */}
            {selectedAction === 'reset' && (
              <div className="mt-1 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 bg-rose-950/30 p-2 rounded-lg border border-rose-900/40 animate-fadeIn">
                <div className="flex items-center gap-2 text-rose-200 text-xs">
                  <Clock size={14} className="text-rose-400" />
                  <span className="font-semibold">Thời gian ngắt nguồn PoE trước khi bật lại (no shutdown):</span>
                </div>

                <div className="flex items-center gap-1.5">
                  {[15, 20, 25, 30].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      disabled={loadingCmd}
                      onClick={() => setDelaySeconds(sec)}
                      className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${delaySeconds === sec ? 'bg-rose-600 text-white shadow' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                    >
                      {sec}s {sec === 15 ? '(Khuyên dùng)' : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Terminal Console Output */}
          <div className="relative flex-1 bg-slate-900 rounded-xl border border-slate-800 p-4 font-mono text-xs text-slate-200 overflow-auto custom-scrollbar whitespace-pre-wrap leading-relaxed shadow-inner">
            {terminalOutput}

            {/* Action buttons inside terminal */}
            <div className="absolute top-3 right-3 flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-2.5 py-1 bg-slate-800/90 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 text-xs flex items-center gap-1.5 shadow"
                title="Sao chép kết quả log"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copied ? 'Đã sao chép' : 'Sao chép'}
              </button>
              <button
                onClick={() => setTerminalOutput(`--- SẴN SÀNG (${target.switch_ip}) ---`)}
                className="px-2.5 py-1 bg-slate-800/90 hover:bg-slate-700 text-slate-400 rounded border border-slate-700 text-xs"
                title="Xóa màn hình log"
              >
                Xóa
              </button>
            </div>
          </div>

          {/* Command Preview (CHỈ SHOW XEM - KHÔNG CHO SỬA) */}
          <form
            onSubmit={handleExecute}
            className="flex flex-col gap-2 bg-slate-900 p-3 rounded-xl border border-slate-800 shadow-md"
          >
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-semibold text-blue-400 flex items-center gap-1.5">
                <Lock size={12} className="text-amber-400" />
                Lệnh mẫu sẽ gửi tới Switch ({target.switch_ip}):
              </span>
              <span className="text-slate-500 font-medium">
                (Chỉ hiển thị để kiểm tra an toàn — Không cho phép sửa)
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* Monospace Code Display Box (Read-Only) */}
              <div className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-emerald-400 font-mono text-xs overflow-x-auto whitespace-pre font-semibold select-all shadow-inner">
                {getCommandText()}
              </div>

              {/* Action Button */}
              <button
                type="submit"
                disabled={loadingCmd}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors shadow-sm whitespace-nowrap justify-center text-white ${
                  selectedAction === 'reset'
                    ? 'bg-rose-600 hover:bg-rose-700 disabled:opacity-50 ring-2 ring-rose-500/40'
                    : 'bg-blue-600 hover:bg-blue-700 disabled:opacity-50'
                }`}
              >
                {loadingCmd ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {selectedAction === 'reset' ? (
                      countdown > 0 ? `Đang chờ xả nguồn (${countdown}s)...` : 'Đang thực thi reset...'
                    ) : (
                      'Đang gửi lệnh...'
                    )}
                  </>
                ) : (
                  <>
                    {selectedAction === 'reset' ? <RotateCw size={14} /> : <Play size={14} className="fill-current" />}
                    {selectedAction === 'reset' ? `Thực Thi Reset Cổng (${delaySeconds}s)` : 'Chạy Lệnh (Enter)'}
                  </>
                )}
              </button>
            </div>
          </form>

        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <Shield size={13} className="text-emerald-500" />
            Bảo vệ an toàn Switch: Toàn bộ lệnh đã được kiểm định trước khi thực thi.
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

