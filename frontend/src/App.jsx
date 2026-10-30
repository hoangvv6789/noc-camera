import React, { useState, useEffect, useCallback } from 'react';
import {
  Camera,
  CheckCircle,
  AlertCircle,
  Network,
  HardDrive,
  AlertTriangle,
  Bell,
  Volume2,
  VolumeX,
  Server,
  Radio,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import ThemeToggle from './components/ThemeToggle';
import StatsCard from './components/StatsCard';
import Toolbar from './components/Toolbar';
import CameraTable from './components/CameraTable';
import AddCameraModal from './components/AddCameraModal';
import AddSwitchModal from './components/AddSwitchModal';
import ImportModal from './components/ImportModal';
import SshScanModal from './components/SshScanModal';
import SwitchPortModal from './components/SwitchPortModal';
import Cms2SyncModal from './components/Cms2SyncModal';

// NVR Components & Hooks
import NVRToolbar from './components/NVRToolbar';
import NVRTable from './components/NVRTable';
import AddNVRModal from './components/AddNVRModal';
import AlertsModal from './components/AlertsModal';
import SwitchManagement from './components/SwitchManagement';
import { useDashboard } from './hooks/useDashboard';
import { useCameras } from './hooks/useCameras';
import { useNVRs } from './hooks/useNVRs';
import { useWebSocket } from './hooks/useWebSocket';
import {
  fetchSwitches,
  fetchAlerts,
  clearAlerts,
  triggerPingScan,
  pingSingleCamera,
  toggleCameraStatus,
  scanSingleCameraMac,
  updateCameraName,
  deleteCamera,
  triggerNvrScan,
  triggerSingleNvrScan,
  syncNvrCameras,
  deleteNVR,
} from './api/client';


// Âm thanh cảnh báo Web Audio API (không cần file âm thanh ngoài)
function playAlertBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // 880 Hz
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // Ignore audio restriction
  }
}

// Thông báo popup màn hình Desktop/Windows
function sendDesktopNotification(title, body) {
  try {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            new Notification(title, { body });
          }
        });
      }
    }
  } catch (e) {
    // Ignore notification error
  }
}

export default function App() {
  const queryClient = useQueryClient();

  // Tab chính: 'camera' | 'nvr'
  const [activeMainTab, setActiveMainTab] = useState('camera');

  // Filters Camera
  const [filters, setFilters] = useState({
    page: 1,
    page_size: 50,
    status: '',
    search: '',
    switch_id: '',
  });

  // Filters NVR
  const [nvrFilters, setNvrFilters] = useState({
    page: 1,
    page_size: 50,
    status: '',
    search: '',
  });

  const [switches, setSwitches] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isNvrScanning, setIsNvrScanning] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Alerts & Notifications state
  const [alerts, setAlerts] = useState([]);
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('sound_alerts_enabled') !== 'false';
  });

  // Modals state
  const [isAddCameraOpen, setIsAddCameraOpen] = useState(false);
  const [isAddSwitchOpen, setIsAddSwitchOpen] = useState(false);
  const [isAddNVROpen, setIsAddNVROpen] = useState(false);
  const [editNVRTarget, setEditNVRTarget] = useState(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importTab, setImportTab] = useState('camera');
  const [isSshScanOpen, setIsSshScanOpen] = useState(false);
  const [sshScanTargetCamera, setSshScanTargetCamera] = useState(null);
  const [pingingCameraId, setPingingCameraId] = useState(null);
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [inspectTarget, setInspectTarget] = useState(null);
  const [isCms2SyncOpen, setIsCms2SyncOpen] = useState(false);


  const handleInspectSwitchPort = useCallback((cameraRow) => {
    setInspectTarget(cameraRow);
    setIsInspectOpen(true);
  }, []);


  // Queries & WebSocket
  const { data: summary } = useDashboard();
  const { data: camerasData, isLoading: isLoadingCameras } = useCameras(filters);
  const { data: nvrsData, isLoading: isLoadingNVRs } = useNVRs(nvrFilters);
  const { connected: wsConnected, lastEvent } = useWebSocket();

  // Load danh sách switch & alerts
  const loadSwitches = () => {
    fetchSwitches().then((data) => setSwitches(data)).catch(console.error);
  };

  const loadAlerts = () => {
    fetchAlerts().then((data) => setAlerts(data || [])).catch(console.error);
  };

  useEffect(() => {
    loadSwitches();
    loadAlerts();
    // Xin quyền Desktop Notification
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const handleToggleSound = () => {
    const nextVal = !soundEnabled;
    setSoundEnabled(nextVal);
    localStorage.setItem('sound_alerts_enabled', String(nextVal));
    if (nextVal) playAlertBeep();
  };

  const showToast = (msg, isDanger = false) => {
    setToastMessage({ text: msg, isDanger });
    setTimeout(() => setToastMessage(null), 5500);
  };

  // WebSocket event handler
  useEffect(() => {
    if (!lastEvent) return;

    const evType = lastEvent.event_type || lastEvent.type;
    const data = lastEvent.data || lastEvent;

    if (evType === 'scan_complete') {
      const msg = data.message || `Đã hoàn tất quét định vị MAC: ${data.total_mapped || 0} Camera!`;
      showToast(`🎯 ${msg}`, false);
      sendDesktopNotification('🎯 Hoàn tất quét MAC Cisco Switch', msg);
      loadSwitches();
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['switches'] });
    } else if (evType === 'status_change') {
      const isOffline = data.new_status === 'OFFLINE';

      if (isOffline) {
        if (soundEnabled) playAlertBeep();
        sendDesktopNotification(
          '⚠️ CẢNH BÁO: Camera Treo / Mất Kết Nối',
          `Camera "${data.camera_name || data.camera_id}" (${data.camera_ip}) vừa bị mất kết nối!`
        );
        showToast(`🚨 CẢNH BÁO: Camera ${data.camera_name || data.camera_id} (${data.camera_ip}) -> 🔴 MẤT KẾT NỐI!`, true);
      } else {
        showToast(`🟢 Camera ${data.camera_name || data.camera_id} (${data.camera_ip}) -> Đã khôi phục kết nối!`, false);
      }

      loadAlerts();
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    } else if (evType === 'nvr_status_change') {
      if (data.new_status === 'SERVICE_FROZEN') {
        if (soundEnabled) playAlertBeep();
        sendDesktopNotification(
          '⚠️ CẢNH BÁO: Đầu Ghi NVR Treo Dịch Vụ',
          `Đầu ghi NVR "${data.nvr_name}" (${data.nvr_ip}) đang bị treo dịch vụ!`
        );
        showToast(`⚠️ CẢNH BÁO: Đầu ghi NVR "${data.nvr_name}" (${data.nvr_ip}) -> TREO DỊCH VỤ!`, true);
      } else if (data.new_status === 'OFFLINE') {
        if (soundEnabled) playAlertBeep();
        showToast(`🔴 CẢNH BÁO: Đầu ghi NVR "${data.nvr_name}" (${data.nvr_ip}) -> MẤT KẾT NỐI!`, true);
      } else {
        showToast(`🟢 Đầu ghi NVR "${data.nvr_name}" (${data.nvr_ip}) -> Đang hoạt động bình thường`, false);
      }

      queryClient.invalidateQueries({ queryKey: ['nvrs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    }
  }, [lastEvent, queryClient, soundEnabled]);

  const handleClearAlertHistory = async () => {
    try {
      await clearAlerts();
      setAlerts([]);
      showToast('Đã xóa toàn bộ lịch sử cảnh báo sự cố');
    } catch {
      showToast('Lỗi khi xóa lịch sử cảnh báo');
    }
  };

  // Camera Filters handlers
  const handleSearch = useCallback((val) => {
    setFilters((prev) => (prev.search === val ? prev : { ...prev, search: val, page: 1 }));
  }, []);

  const handleStatus = useCallback((val) => {
    setFilters((prev) => (prev.status === val ? prev : { ...prev, status: val, page: 1 }));
  }, []);

  const handleSwitch = useCallback((val) => {
    setFilters((prev) => (prev.switch_id === val ? prev : { ...prev, switch_id: val, page: 1 }));
  }, []);

  const handleMappedChange = useCallback((val) => {
    setFilters((prev) => (prev.mapped === val ? prev : { ...prev, mapped: val, page: 1 }));
  }, []);

  const handlePage = useCallback((page) => {
    setFilters((prev) => (prev.page === page ? prev : { ...prev, page }));
  }, []);

  const handlePageSize = useCallback((pageSize) => {
    setFilters((prev) => (prev.page_size === pageSize ? prev : { ...prev, page_size: pageSize, page: 1 }));
  }, []);

  // NVR Filters handlers
  const handleNvrSearch = useCallback((val) => {
    setNvrFilters((prev) => (prev.search === val ? prev : { ...prev, search: val, page: 1 }));
  }, []);

  const handleNvrStatus = useCallback((val) => {
    setNvrFilters((prev) => (prev.status === val ? prev : { ...prev, status: val, page: 1 }));
  }, []);

  const handleNvrPage = useCallback((page) => {
    setNvrFilters((prev) => (prev.page === page ? prev : { ...prev, page }));
  }, []);

  const handleNvrPageSize = useCallback((pageSize) => {
    setNvrFilters((prev) => (prev.page_size === pageSize ? prev : { ...prev, page_size: pageSize, page: 1 }));
  }, []);

  // Camera Actions
  const handleRenameCamera = async (cameraId, newName) => {
    try {
      await updateCameraName(cameraId, newName);
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      showToast(`Đã đổi tên camera thành "${newName}"`);
    } catch (err) {
      showToast(err.response?.data?.detail || 'Lỗi khi đổi tên camera', true);
      throw err;
    }
  };

  const handleDeleteCamera = async (cameraId, cameraName) => {
    if (!window.confirm(`Bạn có chắc muốn xóa camera "${cameraName}"?`)) return;
    try {
      await deleteCamera(cameraId);
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      showToast(`Đã xóa camera "${cameraName}"`);
    } catch (err) {
      showToast(err.response?.data?.detail || 'Lỗi khi xóa camera', true);
    }
  };

  const handlePingCamera = async (camera) => {
    if (pingingCameraId === camera.id) return;
    setPingingCameraId(camera.id);
    showToast(`📡 Đang Ping kiểm tra kết nối "${camera.name}" (${camera.ip})...`);
    try {
      const res = await pingSingleCamera(camera.id);
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      if (res.alive) {
        showToast(`🟢 ${res.message}`);
      } else {
        showToast(`🔴 ${res.message}`, true);
      }
    } catch (err) {
      showToast(err.response?.data?.detail || 'Lỗi khi ping camera', true);
    } finally {
      setPingingCameraId(null);
    }
  };

  const handleToggleCameraStatus = async (camera) => {
    const nextStatus = camera.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
    try {
      await toggleCameraStatus(camera.id, nextStatus);
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      showToast(`Đã chuyển trạng thái camera "${camera.name}" sang ${nextStatus === 'ONLINE' ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
    } catch (err) {
      showToast(err.response?.data?.detail || 'Lỗi khi đổi trạng thái camera', true);
    }
  };

  const handleScanCameraMac = (camera) => {
    setSshScanTargetCamera(camera);
    setIsSshScanOpen(true);
  };

  const handlePingScan = async () => {
    setIsScanning(true);
    try {
      await triggerPingScan();
      showToast('⚡ Đã bắt đầu quét Ping toàn bộ Camera...');
    } catch {
      showToast('❌ Lỗi khi kích hoạt quét Ping.', true);
    }
    setIsScanning(false);
  };

  const handleMacScan = () => {
    setSshScanTargetCamera(null);
    setIsSshScanOpen(true);
  };

  const handleSshScanSuccess = (msg) => {
    showToast(msg || '⚡ Đang thực hiện quét bảng MAC qua SSH... Vui lòng chờ thông báo hoàn tất!');
  };


  // NVR Actions
  const handleNvrScanAll = async () => {
    setIsNvrScanning(true);
    try {
      await triggerNvrScan();
      showToast('⚡ Đã bắt đầu quét kiểm tra dịch vụ toàn bộ đầu ghi NVR...');
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['nvrs'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      }, 3000);
    } catch {
      showToast('❌ Lỗi khi kích hoạt quét NVR.', true);
    } finally {
      setIsNvrScanning(false);
    }
  };

  const handleScanSingleNVR = async (nvrId) => {
    try {
      const res = await triggerSingleNvrScan(nvrId);
      queryClient.invalidateQueries({ queryKey: ['nvrs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      const statusLabel = res.status === 'ONLINE' ? '🟢 Hoạt Động' : res.status === 'SERVICE_FROZEN' ? '⚠️ TREO DỊCH VỤ' : '🔴 Mất Mạng';
      showToast(`Kết quả NVR ${res.name}: ${statusLabel}`);
    } catch (err) {
      showToast(err.response?.data?.detail || 'Lỗi khi quét NVR', true);
    }
  };

  const handleDeleteNVR = async (nvrId, nvrName) => {
    if (!window.confirm(`Bạn có chắc muốn xóa đầu ghi NVR "${nvrName}"?`)) return;
    try {
      await deleteNVR(nvrId);
      queryClient.invalidateQueries({ queryKey: ['nvrs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      showToast(`Đã xóa đầu ghi NVR "${nvrName}"`);
    } catch (err) {
      showToast(err.response?.data?.detail || 'Lỗi khi xóa NVR', true);
    }
  };

  const handleCms2SyncSuccess = (res) => {
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    queryClient.invalidateQueries({ queryKey: ['nvrs'] });
    showToast(`Đã đồng bộ ${res?.total_cameras || 0} camera từ CMS 2.0! (Mới: ${res?.cameras_added || 0}, Cập nhật: ${res?.cameras_updated || 0})`);
  };


  const [isNvrSyncing, setIsNvrSyncing] = useState(false);

  const handleSyncCameras = async (nvrId) => {
    try {
      showToast('🔄 Đang kết nối tới đầu ghi NVR và kéo danh sách Camera...');
      const res = await syncNvrCameras(nvrId);
      queryClient.invalidateQueries({ queryKey: ['nvrs'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      if (res.success) {
        showToast(`✅ ${res.message}`);
      } else {
        showToast(`⚠️ ${res.message}`, true);
      }
    } catch (err) {
      showToast(err.response?.data?.detail || 'Lỗi khi đồng bộ camera từ NVR', true);
    }
  };

  const handleSyncAllNvrs = async () => {
    const nvrs = nvrsData?.items || [];
    if (nvrs.length === 0) {
      showToast('⚠️ Chưa có đầu ghi NVR nào trong hệ thống. Hãy bấm "+ Thêm NVR" trước.', true);
      return;
    }
    setIsNvrSyncing(true);
    showToast(`🔄 Đang kết nối và đồng bộ Camera từ đầu ghi NVR...`);
    try {
      for (const nvr of nvrs) {
        await handleSyncCameras(nvr.id);
      }
    } finally {
      setIsNvrSyncing(false);
    }
  };

  const handleEditNVR = (nvr) => {
    setEditNVRTarget(nvr);
    setIsAddNVROpen(true);
  };

  // Modal Callbacks
  const handleAddCameraSuccess = (msg) => {
    showToast(msg);
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  const handleAddNVRSuccess = (msg) => {
    showToast(msg);
    queryClient.invalidateQueries({ queryKey: ['nvrs'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  const handleAddSwitchSuccess = (msg) => {
    showToast(msg);
    loadSwitches();
    queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  const handleImportSuccess = (msg) => {
    showToast(msg);
    loadSwitches();
    queryClient.invalidateQueries({ queryKey: ['cameras'] });
    queryClient.invalidateQueries({ queryKey: ['nvrs'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
  };

  const openImportModal = (tab = 'camera') => {
    setImportTab(tab);
    setIsImportOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-slate-50 dark:bg-slate-900 transition-colors">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 py-3 px-6 sticky top-0 z-20 shadow-sm flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <div className="p-1.5 bg-blue-600 rounded-lg text-white shadow-sm">
              <Camera size={20} />
            </div>
            Camera & NVR NOC Dashboard
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Hệ thống giám sát Camera, phát hiện Treo Service NVR ACTi & định vị Port Switch Cisco
          </p>
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          {/* NVR Frozen Alert Badge if any */}
          {summary?.frozen_nvrs > 0 && (
            <button
              onClick={() => setActiveMainTab('nvr')}
              className="flex items-center gap-1.5 text-xs font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 px-3 py-1.5 rounded-full border border-amber-300 dark:border-amber-700/60 shadow-sm animate-pulse cursor-pointer hover:bg-amber-200 dark:hover:bg-amber-900/80 transition-colors"
            >
              <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400" />
              <span>{summary.frozen_nvrs} NVR Treo Service!</span>
            </button>
          )}

          {/* Sound Alert Toggle */}
          <button
            onClick={handleToggleSound}
            title={soundEnabled ? 'Chuông cảnh báo đang BẬT (Bấm để tắt)' : 'Chuông cảnh báo đang TẮT (Bấm để bật)'}
            className={`p-2 rounded-xl border transition-colors ${
              soundEnabled
                ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800'
                : 'bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700'
            }`}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          {/* Notification Bell with Badge */}
          <button
            onClick={() => setIsAlertsOpen(true)}
            title="Xem danh sách cảnh báo sự cố"
            className="relative p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700"
          >
            <Bell size={16} />
            {summary?.offline_cameras > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                {summary.offline_cameras > 9 ? '9+' : summary.offline_cameras}
              </span>
            )}
          </button>

          {/* WebSocket Status */}
          <div className="flex items-center gap-2 text-xs font-medium bg-slate-100 dark:bg-slate-700/60 px-3 py-1.5 rounded-full">
            <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 animate-pulse-green' : 'bg-red-500 animate-pulse-red'}`} />
            <span className="text-slate-700 dark:text-slate-200 hidden sm:inline">
              {wsConnected ? 'Thời gian thực' : 'Mất kết nối'}
            </span>
          </div>

          <ThemeToggle />
        </div>
      </header>

      {/* Main Navigation Tabs */}
      <div className="bg-white dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 px-6 pt-2 sticky top-[69px] z-10 shadow-xs">
        <div className="max-w-[1600px] mx-auto flex items-center gap-2">
          <button
            onClick={() => setActiveMainTab('camera')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-b-2 transition-all ${
              activeMainTab === 'camera'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Camera size={18} />
            <span>Giám Sát Camera ({summary?.total_cameras || 0})</span>
            {summary?.offline_cameras > 0 && (
              <span className="px-1.5 py-0.2 text-[11px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 rounded-full">
                {summary.offline_cameras}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveMainTab('nvr')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-b-2 transition-all ${
              activeMainTab === 'nvr'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <HardDrive size={18} />
            <span>Quản Lý & Giám Sát Đầu Ghi NVR ({summary?.total_nvrs || 0})</span>
            {summary?.frozen_nvrs > 0 && (
              <span className="px-2 py-0.5 text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 rounded-full border border-amber-300 dark:border-amber-700 animate-pulse">
                ⚠️ {summary.frozen_nvrs} Treo
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveMainTab('switch')}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-b-2 transition-all ${
              activeMainTab === 'switch'
                ? 'border-amber-600 text-amber-600 dark:text-amber-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Network size={18} />
            <span>Quản Lý Switch ({switches.length || summary?.total_switches || 0})</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto flex flex-col gap-5">
        
        {/* ========================================================================= */}
        {/* TAB 1: GIÁM SÁT CAMERA */}
        {/* ========================================================================= */}
        {activeMainTab === 'camera' && (
          <>
            {/* KPI Cards Camera */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <StatsCard 
                title="Tổng Camera" 
                value={summary?.total_cameras || 0} 
                icon={Camera} 
                color="blue" 
              />
              <StatsCard 
                title="Hoạt Động" 
                value={summary?.online_cameras || 0} 
                icon={CheckCircle} 
                color="green" 
              />
              <StatsCard 
                title="Mất Kết Nối" 
                value={summary?.offline_cameras || 0} 
                icon={AlertCircle} 
                color="red" 
              />
              <StatsCard 
                title="Đã Định Vị Port" 
                value={`${summary?.total_mapped_cameras || 0}`} 
                subtitle={`${summary?.total_cameras ? Math.round(((summary?.total_mapped_cameras || 0) / summary.total_cameras) * 100) : 0}% trên 60 Switch`}
                icon={Radio} 
                color="purple" 
              />
              <StatsCard 
                title="Tổng Switch" 
                value={switches.length || summary?.total_switches || 0} 
                icon={Network} 
                color="yellow" 
              />
            </div>

            {/* Alert Banner Camera */}
            {summary?.offline_cameras > 0 && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3.5 rounded-xl flex items-start justify-between gap-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <AlertCircle className="text-red-500 mt-0.5 flex-shrink-0" size={18} />
                  <div>
                    <h3 className="text-red-800 dark:text-red-300 font-semibold text-sm">
                      Cảnh báo: Có {summary.offline_cameras} camera đang mất kết nối / treo tín hiệu!
                    </h3>
                    <p className="text-red-700 dark:text-red-400 text-xs mt-0.5">
                      Kiểm tra lại nguồn điện, dây mạng hoặc luồng video của các camera đang báo đỏ.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setIsAlertsOpen(true)}
                  className="px-3 py-1 text-xs font-semibold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-900/80 rounded-lg transition-colors whitespace-nowrap"
                >
                  Xem chi tiết
                </button>
              </div>
            )}

            {/* Toolbar Camera */}
            <Toolbar 
              onSearchChange={handleSearch}
              onStatusChange={handleStatus}
              onSwitchChange={handleSwitch}
              onMappedChange={handleMappedChange}
              onPingScan={handlePingScan}
              onMacScan={handleMacScan}
              onOpenAddCamera={() => setIsAddCameraOpen(true)}
              onOpenAddSwitch={() => setIsAddSwitchOpen(true)}
              onOpenImport={() => openImportModal('camera')}
              onOpenCms2Sync={() => setIsCms2SyncOpen(true)}
              switches={switches}
              isScanning={isScanning}
            />


            {/* Camera Table */}
            <div className="flex-1 min-h-0">
              <CameraTable 
                data={camerasData?.items || []}
                isLoading={isLoadingCameras}
                pagination={{
                  page: camerasData?.page || 1,
                  page_size: filters.page_size,
                  total_pages: camerasData?.total_pages || 1,
                  total_items: camerasData?.total || 0,
                }}
                onPageChange={handlePage}
                onPageSizeChange={handlePageSize}
                onRenameCamera={handleRenameCamera}
                onDeleteCamera={handleDeleteCamera}
                onInspectSwitchPort={handleInspectSwitchPort}
                onPingCamera={handlePingCamera}
                onToggleStatus={handleToggleCameraStatus}
                onScanCameraMac={handleScanCameraMac}
                pingingCameraId={pingingCameraId}
              />
            </div>
          </>
        )}


        {/* ========================================================================= */}
        {/* TAB 2: QUẢN LÝ & GIÁM SÁT ĐẦU GHI NVR */}
        {/* ========================================================================= */}
        {activeMainTab === 'nvr' && (
          <>
            {/* KPI Cards NVR */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatsCard 
                title="Tổng Đầu Ghi NVR" 
                value={summary?.total_nvrs || 0} 
                icon={HardDrive} 
                color="purple" 
              />
              <StatsCard 
                title="Dịch Vụ Bình Thường" 
                value={summary?.online_nvrs || 0} 
                icon={CheckCircle} 
                color="green" 
              />
              <StatsCard 
                title="⚠️ Treo Dịch Vụ" 
                value={summary?.frozen_nvrs || 0} 
                icon={AlertTriangle} 
                color="yellow" 
              />
              <StatsCard 
                title="Mất Mạng (Offline)" 
                value={summary?.offline_nvrs || 0} 
                icon={AlertCircle} 
                color="red" 
              />
            </div>

            {/* Alert Banner khi có NVR Treo Dịch Vụ */}
            {summary?.frozen_nvrs > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 p-3.5 rounded-xl flex items-start gap-3 shadow-sm">
                <AlertTriangle className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" size={20} />
                <div>
                  <h3 className="text-amber-900 dark:text-amber-200 font-bold text-sm">
                    Cảnh báo khẩn cấp: Có {summary.frozen_nvrs} đầu ghi NVR đang bị TREO DỊCH VỤ!
                  </h3>
                  <p className="text-amber-800 dark:text-amber-300 text-xs mt-0.5">
                    Hệ điều hành NVR vẫn phản hồi Ping ICMP nhưng các cổng dịch vụ thiết yếu (Web HTTP 80/8080, RTSP Stream 554, hoặc ACTi Media Port 6012) bị timeout hoặc từ chối kết nối. Hãy kiểm tra và khởi động lại dịch vụ NVR.
                  </p>
                </div>
              </div>
            )}

            {/* Alert Banner khi có NVR Mất mạng */}
            {summary?.offline_nvrs > 0 && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 rounded-xl flex items-start gap-3 shadow-sm">
                <AlertCircle className="text-red-500 mt-0.5 flex-shrink-0" size={18} />
                <div className="text-xs">
                  <span className="font-semibold text-red-800 dark:text-red-300">
                    Có {summary.offline_nvrs} đầu ghi NVR bị mất kết nối mạng hoàn toàn.
                  </span>
                </div>
              </div>
            )}

            {/* Toolbar NVR */}
            <NVRToolbar 
              onSearchChange={handleNvrSearch}
              onStatusChange={handleNvrStatus}
              onNvrScan={handleNvrScanAll}
              onOpenAddNVR={() => {
                setEditNVRTarget(null);
                setIsAddNVROpen(true);
              }}
              onOpenImport={() => openImportModal('nvr')}
              onSyncAll={handleSyncAllNvrs}
              isScanning={isNvrScanning}
              isSyncing={isNvrSyncing}
            />

            {/* NVR Table */}
            <div className="flex-1 min-h-0">
              <NVRTable 
                data={nvrsData?.items || []}
                isLoading={isLoadingNVRs}
                pagination={{
                  page: nvrsData?.page || 1,
                  page_size: nvrFilters.page_size,
                  total_pages: nvrsData?.total_pages || 1,
                  total_items: nvrsData?.total || 0,
                }}
                onPageChange={handleNvrPage}
                onPageSizeChange={handleNvrPageSize}
                onEditNVR={handleEditNVR}
                onDeleteNVR={handleDeleteNVR}
                onScanSingleNVR={handleScanSingleNVR}
                onSyncCameras={handleSyncCameras}
              />
            </div>
          </>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: QUẢN LÝ SWITCH */}
        {/* ========================================================================= */}
        {activeMainTab === 'switch' && (
          <SwitchManagement
            switches={switches}
            onRefresh={loadSwitches}
            onOpenImport={() => openImportModal('switch')}
            onInspectPort={handleInspectSwitchPort}
            showToast={showToast}
          />
        )}

      </main>

      {/* Footer */}
      <footer className="py-3 px-6 border-t border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400 dark:text-slate-500">
        Camera NOC Dashboard v1.3.0 &copy; {new Date().getFullYear()} · Giám sát Camera & Đầu ghi NVR ACTi Real-time
      </footer>

      {/* Modals */}
      <AddCameraModal
        isOpen={isAddCameraOpen}
        onClose={() => setIsAddCameraOpen(false)}
        onSuccess={handleAddCameraSuccess}
      />

      <AddNVRModal
        isOpen={isAddNVROpen}
        onClose={() => {
          setIsAddNVROpen(false);
          setEditNVRTarget(null);
        }}
        onSuccess={handleAddNVRSuccess}
        editTarget={editNVRTarget}
      />

      <AddSwitchModal
        isOpen={isAddSwitchOpen}
        onClose={() => setIsAddSwitchOpen(false)}
        onSuccess={handleAddSwitchSuccess}
      />

      <ImportModal
        isOpen={isImportOpen}
        initialTab={importTab}
        onClose={() => setIsImportOpen(false)}
        onSuccess={handleImportSuccess}
      />

      <SshScanModal
        isOpen={isSshScanOpen}
        targetCamera={sshScanTargetCamera}
        onClose={() => {
          setIsSshScanOpen(false);
          setSshScanTargetCamera(null);
        }}
        onSuccess={handleSshScanSuccess}
      />


      <SwitchPortModal
        isOpen={isInspectOpen}
        onClose={() => setIsInspectOpen(false)}
        target={inspectTarget}
      />

      <Cms2SyncModal
        isOpen={isCms2SyncOpen}
        onClose={() => setIsCms2SyncOpen(false)}
        onSyncSuccess={handleCms2SyncSuccess}
      />

      <AlertsModal
        isOpen={isAlertsOpen}
        onClose={() => setIsAlertsOpen(false)}
        alerts={alerts}
        onClearAlerts={handleClearAlertHistory}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
      />


      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 text-sm px-4 py-3 rounded-xl shadow-2xl z-50 flex items-center gap-3 border animate-slideUp max-w-md ${
            toastMessage.isDanger
              ? 'bg-rose-900 text-rose-50 border-rose-700'
              : 'bg-slate-900 text-white border-slate-700'
          }`}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              toastMessage.isDanger ? 'bg-rose-400 animate-ping' : 'bg-blue-400 animate-pulse'
            }`}
          />
          <span className="font-medium">{toastMessage.text}</span>
        </div>
      )}
    </div>
  );
}
