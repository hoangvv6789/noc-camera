import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Hook kết nối WebSocket tới backend.
 *
 * URL tự động:
 *   - Dev (Vite :5173): ws://localhost:5173/api/events/ws  → Vite proxy (ws:true) → backend :8000
 *   - Production (Nginx): wss://<host>/api/events/ws       → Nginx proxy
 *
 * Tính năng:
 *   - Auto-reconnect sau 3s nếu mất kết nối bất thường
 *   - Hủy timer khi unmount để tránh memory leak
 *   - Không spam console error mỗi lần thử reconnect
 */
export const useWebSocket = () => {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const isMountedRef = useRef(true);
  const queryClient = useQueryClient();

  const getWsUrl = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Khi chạy Vite dev (:5173), proxy WS của Vite không ổn định với một số phiên bản
    // → kết nối thẳng vào backend :8000 để đảm bảo ổn định
    if (window.location.port === '5173' || window.location.port === '3000') {
      return `${proto}//localhost:8687/api/events/ws`;
    }
    // Production (Nginx proxy): dùng cùng host
    return `${proto}//${window.location.host}/api/events/ws`;
  }, []);

  const connect = useCallback(() => {
    if (!isMountedRef.current) return;
    // Không mở thêm nếu đang CONNECTING hoặc OPEN
    if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING ||
                           wsRef.current.readyState === WebSocket.OPEN)) return;

    const wsUrl = getWsUrl();

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) { ws.close(1000); return; }
        setConnected(true);
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };

      ws.onclose = (event) => {
        if (!isMountedRef.current) return;
        setConnected(false);
        // Chỉ reconnect khi đóng không chủ động (code !== 1000)
        if (event.code !== 1000) {
          reconnectTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) connect();
          }, 3000);
        }
      };

      ws.onerror = () => {
        // onerror luôn đi kèm onclose → để onclose xử lý reconnect
        // Không log ở đây để tránh spam khi đang reconnect
        if (!isMountedRef.current) return;
        setConnected(false);
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          const evType = data.event_type || data.type;
          setLastEvent({ ...data, type: evType, event_type: evType });
          if (evType === 'init_snapshot' && data.data) {
            queryClient.setQueryData(['dashboard-summary'], data.data);
          } else if (evType === 'status_change' || evType === 'scan_complete') {
            queryClient.invalidateQueries({ queryKey: ['cameras'] });
            queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
            queryClient.invalidateQueries({ queryKey: ['switches'] });
          }

        } catch {
          // Bỏ qua message không phải JSON (ping frame từ server)
        }
      };
    } catch (err) {
      console.error('WebSocket init error:', err);
    }
  }, [getWsUrl, queryClient]);

  useEffect(() => {
    isMountedRef.current = true;
    connect();
    return () => {
      isMountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close(1000, 'unmount');
    };
  }, [connect]);

  return { connected, lastEvent };
};
