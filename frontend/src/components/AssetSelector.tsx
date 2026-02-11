import { useCallback, useEffect, useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';

// ── Constants ──

const COIN_TYPE_RE = /^0x2::coin::Coin<.+>$/;
const PAGE_SIZE = 50;

/** Sui testnet JSON-RPC endpoint — matches the endpoint used by data hooks. */
const JSON_RPC_URL = 'https://fullnode.testnet.sui.io:443';

// ── Types ──

interface AssetInfo {
  objectId: string;
  type: string;
  display?: Record<string, string>;
  /** Raw balance string — only present for Coin objects */
  balance?: string;
}

interface AssetSelectorProps {
  onSelect: (asset: {
    objectId: string;
    type: string;
    display?: Record<string, string>;
  }) => void;
}

type Tab = 'nft' | 'coin';

// ── Helpers ──

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

function isCoin(type: string): boolean {
  return COIN_TYPE_RE.test(type);
}

function assetDisplayName(asset: AssetInfo): string {
  return (
    asset.display?.name ??
    asset.display?.description ??
    truncateAddress(asset.objectId)
  );
}

// ── Component ──

/** Asset picker for Create Swap — lists wallet-owned NFTs and Coins */
export default function AssetSelector({ onSelect }: AssetSelectorProps) {
  const account = useCurrentAccount();

  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [tab, setTab] = useState<Tab>('nft');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Fetch owned objects (paginated) ──

  const fetchPage = useCallback(
    async (nextCursor: string | null, append: boolean) => {
      if (!account) return;
      setLoading(true);
      try {
        // The gRPC client lacks getOwnedObjects — use JSON-RPC directly
        const rpcResponse = await fetch(JSON_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'suix_getOwnedObjects',
            params: [
              account.address,
              {
                filter: null,
                options: { showContent: true, showType: true, showDisplay: true },
              },
              nextCursor,
              PAGE_SIZE,
            ],
          }),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { result: res }: { result: any } = await rpcResponse.json();

        const page: AssetInfo[] = (res.data ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((o: any) => o.data)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((o: any) => {
            const type: string = o.data.type ?? '';
            const display: Record<string, string> | undefined =
              o.data.display?.data ?? undefined;
            const balance =
              isCoin(type) && o.data.content?.fields
                ? String(o.data.content.fields.balance ?? '')
                : undefined;
            return { objectId: o.data.objectId, type, display, balance };
          });

        setAssets((prev) => (append ? [...prev, ...page] : page));
        setCursor(res.nextCursor ?? null);
        setHasMore(res.hasNextPage ?? false);
      } catch (err) {
        console.error('Failed to fetch owned objects', err);
      } finally {
        setLoading(false);
      }
    },
    [account],
  );

  // Reset & load first page whenever the wallet changes
  useEffect(() => {
    setAssets([]);
    setCursor(null);
    setSelectedId(null);
    fetchPage(null, false);
  }, [fetchPage]);

  // ── Derived state ──

  const filtered = assets
    .filter((a) => (tab === 'coin' ? isCoin(a.type) : !isCoin(a.type)))
    .filter((a) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        a.objectId.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        assetDisplayName(a).toLowerCase().includes(q)
      );
    });

  const categoryLabel = tab === 'nft' ? 'NFTs' : 'coins';
  const emptyMessage = search ? 'No matching assets.' : `No ${categoryLabel} found.`;

  type ViewState = 'loading' | 'empty' | 'results';
  let viewState: ViewState = 'results';
  if (loading && assets.length === 0) viewState = 'loading';
  else if (filtered.length === 0) viewState = 'empty';

  // ── Handlers ──

  const handleSelect = (asset: AssetInfo) => {
    setSelectedId(asset.objectId);
    onSelect({
      objectId: asset.objectId,
      type: asset.type,
      display: asset.display,
    });
  };

  // ── Render ──

  if (!account) {
    return (
      <div className="rounded-2xl border border-subtle bg-surface p-8 text-center text-sm text-muted">
        Connect your wallet to browse assets.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-subtle bg-surface p-6">
      {/* ── Tabs ── */}
      <div className="mb-4 flex gap-2">
        {(['nft', 'coin'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-xl px-5 py-2 text-sm font-semibold transition-colors cursor-pointer ${
              tab === t
                ? 'gradient-primary text-white'
                : 'bg-surface-soft text-text-secondary hover:text-text-primary'
            }`}
          >
            {t === 'nft' ? 'NFT' : 'Coin'}
          </button>
        ))}
      </div>

      {/* ── Search ── */}
      <input
        type="text"
        placeholder="Search by name or type\u2026"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full rounded-xl border border-subtle bg-bg-primary px-4 py-2.5 text-sm text-text-primary placeholder:text-muted outline-none focus:ring-2 focus:ring-info/30 transition"
      />

      {/* ── Asset grid ── */}
      {viewState === 'loading' && (
        <p className="py-8 text-center text-sm text-muted">Loading assets\u2026</p>
      )}
      {viewState === 'empty' && (
        <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>
      )}
      {viewState === 'results' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map((asset) => {
            const selected = selectedId === asset.objectId;
            return (
              <button
                key={asset.objectId}
                type="button"
                onClick={() => handleSelect(asset)}
                className={`flex flex-col items-start gap-1.5 rounded-2xl border p-4 text-left transition cursor-pointer hover:translate-y-[-2px] hover:shadow-lg ${
                  selected
                    ? 'border-info ring-2 ring-indigo-200 bg-surface-soft'
                    : 'border-subtle bg-surface'
                }`}
              >
                {/* NFT thumbnail */}
                {tab === 'nft' && asset.display?.image_url && (
                  <img
                    src={asset.display.image_url}
                    alt={assetDisplayName(asset)}
                    className="mb-1 h-24 w-full rounded-xl object-cover"
                  />
                )}

                {/* Coin balance */}
                {tab === 'coin' && asset.balance != null && (
                  <span className="font-display text-lg font-bold text-text-primary">
                    {asset.balance}
                  </span>
                )}

                <span className="w-full truncate text-sm font-semibold text-text-primary">
                  {assetDisplayName(asset)}
                </span>
                <span className="w-full truncate text-xs text-muted">
                  {asset.type}
                </span>
                <span className="font-mono text-xs text-muted">
                  {truncateAddress(asset.objectId)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Pagination ── */}
      {hasMore && (
        <button
          type="button"
          onClick={() => fetchPage(cursor, true)}
          disabled={loading}
          className="mt-4 w-full rounded-xl border border-subtle px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-surface-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? 'Loading\u2026' : 'Load more'}
        </button>
      )}
    </div>
  );
}
