import { useQuery } from '@tanstack/react-query';
import { fetchWeatherHistory } from '../api.js';

export function useWeatherHistory(hours = 48) {
  return useQuery({
    queryKey:  ['weather-history', hours],
    queryFn:   () => fetchWeatherHistory(hours),
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  });
}
