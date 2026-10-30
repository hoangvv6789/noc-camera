import { useQuery } from '@tanstack/react-query';
import { fetchCameras } from '../api/client';

export const useCameras = (filters) => {
  return useQuery({
    queryKey: ['cameras', filters],
    queryFn: () => fetchCameras(filters),
    refetchInterval: 30000, // Refetch mỗi 30s
  });
};
