"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import {
  RainbowKitProvider,
  getDefaultConfig,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { BRADBURY_CHAIN } from "@/lib/config";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
const transports = { [BRADBURY_CHAIN.id]: http() };

// WalletConnect is enabled only with an explicit public Cloud project ID.
// Without one, local/CI builds retain injected browser-wallet support and do
// not substitute a fake WalletConnect credential.
const config = walletConnectProjectId
  ? getDefaultConfig({
      appName: "FreelanceEscrow",
      projectId: walletConnectProjectId,
      chains: [BRADBURY_CHAIN],
      transports,
      ssr: false,
    })
  : createConfig({
      chains: [BRADBURY_CHAIN],
      connectors: [injected()],
      transports,
      ssr: false,
    });
const qc = new QueryClient();
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#7164FF",
            accentColorForeground: "white",
            borderRadius: "medium",
            overlayBlur: "large",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
