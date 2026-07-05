export function isProduction(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'plan.tga.edu.au';
}

export function isStagingOrPreview(): boolean {
  return !isProduction();
}
