/**
 * Swap contract interaction hooks.
 *
 * Mirrors useEscrow pattern — one hook per action, self-managed async state.
 */

export function useCreateSwap() {
  // TODO: build tx → swap::create_swap, sign & execute
}

export function useExecuteSwap() {
  // TODO: swap::execute_swap (recipient deposits asset U, atomic exchange)
}

export function useCancelSwap() {
  // TODO: swap::cancel_swap (creator reclaims after timeout, requires Clock)
}

export function useDestroySwap() {
  // TODO: swap::destroy_swap (consumes shared object)
}

export function useMySwaps(_address: string | undefined) {
  // TODO: queryEvents(SwapCreated/Executed/Cancelled) → multiGetObjects → filter by role
  return { data: null, loading: false, error: null, refetch: () => {} };
}

export function useSwapDetail(_swapId: string | undefined) {
  // TODO: getObject + queryEvents for timeline
  return { data: null, loading: false, error: null };
}
