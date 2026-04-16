import { toast } from "sonner";

export const notify = {
  error(title: string, description?: string) {
    toast.error(title, {
      description,
      duration: 5000,
    });
  },

  success(title: string, description?: string) {
    toast.success(title, {
      description,
      duration: 3500,
    });
  },

  info(title: string, description?: string) {
    toast.info(title, {
      description,
      duration: 4000,
    });
  },

  warning(title: string, description?: string) {
    toast.warning(title, {
      description,
      duration: 4500,
    });
  },

  micDenied() {
    toast.error("Microphone access denied", {
      description: "Open browser settings and allow microphone access, then try again.",
      duration: 6000,
    });
  },

  serviceOffline(service: string) {
    toast.error(`${service} service is temporarily unavailable`, {
      description: "Please try again in a moment.",
      duration: 5000,
    });
  },

  quotaExceeded(info?: { plan?: string; resource?: string; limit?: number; used?: number }) {
    const resource = info?.resource?.replace(/_/g, " ") || "resource";
    toast.error("Usage limit reached", {
      description: `You've used your monthly ${resource} quota on the ${info?.plan || "current"} plan. Upgrade for more.`,
      duration: 6000,
    });
  },
};
