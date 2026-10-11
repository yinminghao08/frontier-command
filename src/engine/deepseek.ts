/** Official Chat Completions controls; shared with UI for truthful labels. */
export const isDeepSeek = (baseUrl: string) => {
  try {
    return new URL(baseUrl).hostname === 'api.deepseek.com';
  } catch {
    return false;
  }
};
export const deepSeekModels = [
  'deepseek-flash',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'deepseek-v4-flash-vision-exp',
];
export const deepSeekEffort = (effort: string) =>
  (({ minimal: 'low', medium: 'high', xhigh: 'high' }) as Record<string, string>)[effort] ?? effort;
export const thinkingConflict = (thinking: string, effort: string) =>
  thinking === 'off' && !['provider-default', 'none'].includes(effort);
export const effortLabel = (baseUrl: string, effort: string, label: string) =>
  isDeepSeek(baseUrl) && deepSeekEffort(effort) !== effort
    ? `${label} → 实际 ${deepSeekEffort(effort).toUpperCase()}`
    : label;
