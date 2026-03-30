'use client';

import { useEffect } from 'react';

export default function PopupClosePage() {
  useEffect(() => {
    // Close this popup window after OAuth redirect
    window.close();
  }, []);

  return (
    <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-100">
      <div className="text-center">
        <p className="text-lg font-semibold">Gmail connected!</p>
        <p className="text-sm text-slate-400 mt-2">This window will close automatically...</p>
      </div>
    </div>
  );
}
