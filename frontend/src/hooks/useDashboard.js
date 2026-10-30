import { useQuery } from '@tanstack/react-query';
import { fetchSummary } from '../api/client';

export const useDashboard = () => {
  return useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: fetchSummary,
    refetchInterval: 30000, // Tự động refetch mỗi 30s
  });
};
