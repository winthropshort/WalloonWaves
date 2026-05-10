import { useQuery } from '@tanstack/react-query';
import { fetchLocations } from '../api.js';

export function useLocations() {
  return useQuery({
    queryKey:  ['locations'],
    queryFn:   fetchLocations,
    staleTime: 3 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}
