/** 'America/New_York' → 'New York'; 'Pacific/Auckland' → 'Auckland'. Friendly but unambiguous. */
export function zoneLabel(zone: string): string {
  return (zone.split('/').pop() ?? zone).replaceAll('_', ' ')
}
