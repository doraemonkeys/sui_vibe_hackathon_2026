import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';

const GRPC_URLS: Record<string, string> = {
  mainnet: 'https://fullnode.mainnet.sui.io:443',
  testnet: 'https://fullnode.testnet.sui.io:443',
};

export const dAppKit = createDAppKit({
  // Both networks are listed so wallets that only declare mainnet (e.g. OKX Wallet)
  // still appear in the ConnectModal. Switch defaultNetwork to 'mainnet' for production.
  networks: ['mainnet', 'testnet'],
  defaultNetwork: 'testnet',
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
});

// Register types so hooks infer from this dAppKit instance
declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
