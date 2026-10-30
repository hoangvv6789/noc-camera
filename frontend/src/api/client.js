import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

function cleanParams(params) {
  const clean = {};
  for (const [key, val] of Object.entries(params)) {
    if (val !== null && val !== undefined && val !== '') {
      clean[key] = val;
    }
  }
  return clean;
}

// --- Dashboard & Alerts ---
export const fetchSummary = async () => {
  const { data } = await apiClient.get('/dashboard/summary');
  return data;
};

export const fetchAlerts = async () => {
  const { data } = await apiClient.get('/dashboard/alerts');
  return data;
};

export const clearAlerts = async () => {
  const { data } = await apiClient.post('/dashboard/alerts/clear');
  return data;
};

// --- Cameras ---
export const fetchCameras = async (params) => {
  const { page = 1, page_size = 50, status, search, switch_id, mapped, nvr_id } = params;
  const { data } = await apiClient.get('/cameras', {
    params: cleanParams({ page, page_size, status, search, switch_id, mapped, nvr_id }),
  });
  return data;
};

export const createCamera = async (cameraData) => {
  const { data } = await apiClient.post('/cameras', cameraData);
  return data;
};

export const updateCameraName = async (cameraId, newName) => {
  const { data } = await apiClient.patch(`/cameras/${cameraId}/name`, { name: newName });
  return data;
};

export const deleteCamera = async (cameraId) => {
  const { data } = await apiClient.delete(`/cameras/${cameraId}`);
  return data;
};

export const toggleCameraStatus = async (cameraId, newStatus = null) => {
  const url = newStatus ? `/cameras/${cameraId}/status?status=${newStatus}` : `/cameras/${cameraId}/status`;
  const { data } = await apiClient.patch(url);
  return data;
};

export const pingSingleCamera = async (cameraId) => {
  const { data } = await apiClient.post(`/cameras/${cameraId}/ping`);
  return data;
};

export const scanSingleCameraMac = async (cameraId, creds = null) => {
  const { data } = await apiClient.post(`/cameras/${cameraId}/scan-mac`, creds || {});
  return data;
};


export const importCamerasCsv = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await apiClient.post('/cameras/import-csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

// --- NVRs ---
export const fetchNVRs = async (params) => {
  const { page = 1, page_size = 50, status, search } = params;
  const { data } = await apiClient.get('/nvrs', {
    params: cleanParams({ page, page_size, status, search }),
  });
  return data;
};

export const createNVR = async (nvrData) => {
  const { data } = await apiClient.post('/nvrs', nvrData);
  return data;
};

export const updateNVR = async (nvrId, nvrData) => {
  const { data } = await apiClient.put(`/nvrs/${nvrId}`, nvrData);
  return data;
};

export const deleteNVR = async (nvrId) => {
  const { data } = await apiClient.delete(`/nvrs/${nvrId}`);
  return data;
};

export const triggerNvrScan = async () => {
  const { data } = await apiClient.post('/nvrs/scan');
  return data;
};

export const triggerSingleNvrScan = async (nvrId) => {
  const { data } = await apiClient.post(`/nvrs/${nvrId}/scan`);
  return data;
};

export const syncNvrCameras = async (nvrId) => {
  const { data } = await apiClient.post(`/nvrs/${nvrId}/sync-cameras`);
  return data;
};

export const testNvrConnection = async (nvrId) => {
  const { data } = await apiClient.post(`/nvrs/${nvrId}/test-connection`);
  return data;
};

export const testNvrCredentials = async (payload) => {
  const { data } = await apiClient.post('/nvrs/test-credentials', payload);
  return data;
};


export const importNvrsCsv = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await apiClient.post('/nvrs/import-csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

// --- Switches ---
export const fetchSwitches = async () => {
  const { data } = await apiClient.get('/switches');
  return data;
};

export const createSwitch = async (switchData) => {
  const { data } = await apiClient.post('/switches', switchData);
  return data;
};

export const updateSwitch = async (switchId, switchData) => {
  const { data } = await apiClient.put(`/switches/${switchId}`, switchData);
  return data;
};

export const deleteSwitch = async (switchId) => {
  const { data } = await apiClient.delete(`/switches/${switchId}`);
  return data;
};

export const fetchSwitchCameras = async (switchId) => {
  const { data } = await apiClient.get(`/switches/${switchId}/cameras`);
  return data;
};

export const pingSwitch = async (switchId) => {
  const { data } = await apiClient.post(`/switches/${switchId}/ping`);
  return data;
};

export const pingAllSwitches = async () => {
  const { data } = await apiClient.post('/switches/ping-all');
  return data;
};

export const scanSwitchMac = async (switchId, creds = null) => {
  const { data } = await apiClient.post(`/switches/${switchId}/scan-mac`, creds || {});
  return data;
};

export const importSwitchesCsv = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await apiClient.post('/switches/import-csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

// --- Scan Actions ---
export const triggerPingScan = async () => {
  const { data } = await apiClient.post('/scan/ping');
  return data;
};

export const triggerMacScan = async (creds = null) => {
  if (creds && creds.username) {
    const { data } = await apiClient.post('/scan/ssh-mac', creds);
    return data;
  }
  const { data } = await apiClient.post('/scan/mac-table');
  return data;
};

export const triggerSshScan = async (creds) => {
  const { data } = await apiClient.post('/scan/ssh-mac', creds);
  return data;
};

export const executeSwitchCommand = async (payload) => {
  const { data } = await apiClient.post('/switches/exec-command', payload);
  return data;
};

export const resetSwitchPort = async (payload) => {
  const { data } = await apiClient.post('/switches/reset-port', payload);
  return data;
};

// --- CMS 2.0 Integration ---
export const fetchCms2Config = async () => {
  const { data } = await apiClient.get('/cms2/config');
  return data;
};

export const testCms2Connection = async (creds) => {
  const { data } = await apiClient.post('/cms2/test-connection', creds);
  return data;
};

export const syncCms2 = async (creds) => {
  const { data } = await apiClient.post('/cms2/sync', creds);
  return data;
};



