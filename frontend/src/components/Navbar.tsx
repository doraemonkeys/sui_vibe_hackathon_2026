import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ConnectModal,
  useCurrentAccount,
  useDAppKit,
} from '@mysten/dapp-kit-react';

const NAV_LINKS = [
  { to: '/escrows', label: 'Escrow' },
  { to: '/swaps', label: 'Swap' },
] as const;

function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}\u2026${address.slice(-4)}`;
}

/** Top navigation bar — glassmorphism style, Logo + nav links + wallet button */
export default function Navbar() {
  const [connectOpen, setConnectOpen] = useState(false);
  const modalWrapperRef = useRef<HTMLDivElement>(null);
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  // Keep React state in sync when the Lit ConnectModal closes itself
  // (e.g. user clicks backdrop or successfully connects).
  useEffect(() => {
    const modal = modalWrapperRef.current?.querySelector(
      'mysten-dapp-kit-connect-modal',
    );
    if (!modal) return;
    const syncClosed = () => setConnectOpen(false);
    modal.addEventListener('closed', syncClosed);
    return () => modal.removeEventListener('closed', syncClosed);
  }, []);

  return (
    <nav className="glass fixed top-0 left-0 right-0 z-50">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* ── Logo ── */}
        <NavLink
          to="/"
          className="font-display text-2xl font-bold gradient-text select-none"
        >
          GAVEL
        </NavLink>

        {/* ── Nav links ── */}
        <div className="flex items-center gap-8">
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `group relative py-1 font-semibold transition-colors ${
                  isActive
                    ? 'text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {label}
                  {/* Gradient underline — visible when active, revealed on hover */}
                  <span
                    className={`absolute -bottom-0.5 left-0 h-0.5 w-full rounded-full gradient-primary transition-transform origin-left ${
                      isActive
                        ? 'scale-x-100'
                        : 'scale-x-0 group-hover:scale-x-100'
                    }`}
                  />
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* ── Wallet ── */}
        {account ? (
          <button
            type="button"
            onClick={() => dAppKit.disconnectWallet()}
            className="flex items-center gap-2.5 rounded-xl border border-subtle px-4 py-2.5 font-semibold text-text-secondary hover:bg-surface-soft transition-colors cursor-pointer"
          >
            <span className="h-3 w-3 shrink-0 rounded-full gradient-primary" />
            <span className="font-mono text-sm">
              {truncateAddress(account.address)}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConnectOpen(true)}
            className="rounded-xl border border-subtle px-6 py-2.5 font-semibold text-text-primary hover:bg-surface-soft transition-colors cursor-pointer"
          >
            Connect Wallet
          </button>
        )}
      </div>

      {/* Wallet-connect dialog — always mounted, toggled via the open prop */}
      <div ref={modalWrapperRef}>
        <ConnectModal open={connectOpen} />
      </div>
    </nav>
  );
}
