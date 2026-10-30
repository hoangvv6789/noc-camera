import { useQuery } from '@tanstack/react-query';
import { fetchNVRs } from '../api/client';

export const useNVRs = (filters) => {
  return useQuery({
    queryKey: ['nvrs', filters],
    queryFn: () => fetchNVRs(filters),
    refetchInterval: 30000, // Refetch mỗi 30s
  });
};
