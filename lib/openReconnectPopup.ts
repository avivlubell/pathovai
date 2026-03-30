/**
 * Opens Gmail OAuth in a popup window instead of redirecting away.
 * Polls until the popup closes, then triggers a session refresh.
 */
export function openReconnectPopup(
  onSuccess?: () => void,
  onError?: (err: string) => void
) {
  const width = 500;
  const height = 600;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const popup = window.open(
    '/api/auth/signin/google',
    'gmail-reconnect',
    `width=${width},height=${height},left=${left},top=${top},popup=true`
  );

  if (!popup) {
    onError?.('Popup blocked. Please allow popups for this site.');
    return;
  }

  const interval = setInterval(() => {
    if (popup.closed) {
      clearInterval(interval);
      // Give NextAuth a moment to update the session cookie
      setTimeout(() => {
        onSuccess?.();
      }, 500);
    }
  }, 300);
}
