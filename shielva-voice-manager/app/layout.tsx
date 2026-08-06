import type { Metadata } from "next";
import { Toaster } from "sonner";
import { AuthProvider } from "./context/AuthContext";
import { ProcessingProvider } from "./context/ProcessingContext";
import { VoiceProvider } from "./context/VoiceContext";
import { StorageProvider } from "./context/StorageContext";
import QueryProvider from "./context/QueryProvider";
import AuthGuard from "./components/AuthGuard";
import ProcessingOverlay from "./components/ProcessingOverlay";
import StorageConfigModal from "./components/StorageConfigModal";
import LocalFileMissingToast from "./components/LocalFileMissingToast";
import { ConfirmDialogHost } from "./components/ui/ConfirmDialog";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shielva Voice Manager",
  description: "AI-powered voice intelligence platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Apply theme before first paint to avoid flash */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              var saved = localStorage.getItem('vm-theme');
              var theme = saved || (new Date().getHours() >= 6 && new Date().getHours() < 20 ? 'light' : 'dark');
              document.documentElement.setAttribute('data-theme', theme);
            } catch(e) {}
          })();
        `}} />
      </head>
      <body>
        <AuthProvider>
          <QueryProvider>
          <VoiceProvider>
            <StorageProvider>
            <ProcessingProvider>
              <AuthGuard>
                {children}
              </AuthGuard>
              <ProcessingOverlay />
              <StorageConfigModal />
              <LocalFileMissingToast />
              {/* Single owner of destructive confirmation — see ui/ConfirmDialog. */}
              <ConfirmDialogHost />
            </ProcessingProvider>
            </StorageProvider>
          </VoiceProvider>
          </QueryProvider>
        </AuthProvider>
        <Toaster
          position="top-right"
          expand
          richColors={false}
          closeButton
          gap={10}
          toastOptions={{
            duration: 4000,
            unstyled: false,
            classNames: {
              toast:       "vm-toast",
              title:       "vm-toast-title",
              description: "vm-toast-desc",
              actionButton:"vm-toast-action",
              cancelButton:"vm-toast-cancel",
              closeButton: "vm-toast-close",
              error:       "vm-toast--error",
              success:     "vm-toast--success",
              warning:     "vm-toast--warning",
              info:        "vm-toast--info",
            },
          }}
        />
      </body>
    </html>
  );
}
