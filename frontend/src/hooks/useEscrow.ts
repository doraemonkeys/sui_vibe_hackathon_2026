/**
 * Escrow contract interaction hooks.
 *
 * Each hook encapsulates a single contract action, building the PTB
 * and calling signAndExecuteTransaction via dApp Kit.
 *
 * Data-fetching hooks (useMyEscrows) manage their own loading/error/data
 * state internally — no React Query dependency required.
 */

export function useCreateEscrow() {
  // TODO: build tx → escrow::create_and_share, sign & execute
}

export function useConfirmEscrow() {
  // TODO: escrow::confirm
}

export function useDisputeEscrow() {
  // TODO: escrow::dispute (requires Clock)
}

export function useRejectEscrow() {
  // TODO: escrow::reject
}

export function useArbiterResolve() {
  // TODO: escrow::arbiter_resolve_release / arbiter_resolve_refund
}

export function useTimelockRefund() {
  // TODO: escrow::timelock_refund (requires Clock)
}

export function useDestroyEscrow() {
  // TODO: escrow::destroy (consumes shared object)
}

export function useMyEscrows(_address: string | undefined) {
  // TODO: queryEvents(EscrowCreated) → multiGetObjects → filter by role
  return { data: null, loading: false, error: null, refetch: () => {} };
}
