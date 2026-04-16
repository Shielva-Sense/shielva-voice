"use client";

/**
 * LocalFileMissingToast
 *
 * Watches StorageContext for localFileMissingWarning and fires a sonner toast
 * whenever a locally-cached audio file is unexpectedly missing.
 *
 * This covers the case where a user chose "Persistent" local storage, an audio
 * file was cached to disk, but was later manually deleted.  The toast tells
 * them where to look and falls back to cloud R2 automatically.
 */

import { useEffect } from "react";
import { toast } from "sonner";
import { useStorage } from "../context/StorageContext";

export default function LocalFileMissingToast() {
  const { localFileMissingWarning, clearLocalFileMissingWarning, openModal } = useStorage();

  useEffect(() => {
    if (!localFileMissingWarning) return;

    toast.warning("Local audio file missing", {
      description: localFileMissingWarning,
      duration: 8000,
      action: {
        label: "Storage settings",
        onClick: () => { openModal(); },
      },
      onDismiss: clearLocalFileMissingWarning,
      onAutoClose: clearLocalFileMissingWarning,
    });
  }, [localFileMissingWarning]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
