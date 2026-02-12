/// Coin-specialized Atomic Swap: A deposits item T, B pays Coin<CoinType> to atomically exchange.
/// B's payment and execution are merged into one step — B's coin never enters
/// a "locked but unexecuted" limbo, eliminating counterparty risk for B.
/// The requested_amount field enforces a minimum price on-chain, closing the
/// trustless gap that a generic phantom U could not cover for fungible assets.
module gavel::swap;

use std::string::String;
use sui::event;
use sui::clock::Clock;
use sui::coin::Coin;

// === State Constants ===

const STATE_PENDING: u8 = 0;
const STATE_EXECUTED: u8 = 1;
const STATE_CANCELLED: u8 = 2;

// === Configuration Constants ===

/// 5 minutes — minimum swap duration
const MIN_TIMEOUT_MS: u64 = 300_000;
/// 30 days — maximum swap duration (prevents overflow in deadline arithmetic)
const MAX_TIMEOUT_MS: u64 = 2_592_000_000;
/// Maximum description length in bytes
const MAX_DESCRIPTION_LEN: u64 = 1024;

// === Error Constants ===

#[error]
const ENotAuthorized: vector<u8> = b"Caller is not authorized";
#[error]
const EInvalidState: vector<u8> = b"Swap is not in the expected state";
#[error]
const ETimeoutNotReached: vector<u8> = b"Timeout has not been reached";
#[error]
const ECreatorIsRecipient: vector<u8> = b"Creator and recipient must be different addresses";
#[error]
const ETimeoutTooShort: vector<u8> = b"Timeout must be at least MIN_TIMEOUT_MS";
#[error]
const ETimeoutTooLong: vector<u8> = b"Timeout must be at most MAX_TIMEOUT_MS";
#[error]
const EDescriptionTooLong: vector<u8> = b"Description exceeds MAX_DESCRIPTION_LEN";
#[error]
const EZeroAmount: vector<u8> = b"Requested amount must be greater than zero";
#[error]
const EInsufficientAmount: vector<u8> = b"Payment is less than the requested amount";

// === Core Struct ===

/// `phantom CoinType` encodes the expected payment coin at the type level.
/// Combined with `requested_amount`, the contract enforces both *what* coin
/// and *how much* the recipient must pay — no bypass path exists.
public struct Swap<T: key + store, phantom CoinType> has key {
    id: UID,
    creator: address,
    recipient: address,
    /// Creator's deposited asset.
    /// Invariant: Some when state == Pending; None after execute/cancel extracts it.
    item: Option<T>,
    /// Minimum Coin<CoinType> the creator will accept.
    requested_amount: u64,
    description: String,
    state: u8,
    created_at: u64,
    timeout_ms: u64,
}

// === Events ===

public struct SwapCreated has copy, drop {
    swap_id: ID,
    creator: address,
    recipient: address,
    requested_amount: u64,
    description: String,
    timeout_ms: u64,
    created_at: u64,
}

public struct SwapExecuted has copy, drop {
    swap_id: ID,
    creator: address,
    recipient: address,
    requested_amount: u64,
    amount_paid: u64,
}

public struct SwapCancelled has copy, drop {
    swap_id: ID,
    creator: address,
    recipient: address,
}

public struct SwapDestroyed has copy, drop {
    swap_id: ID,
    creator: address,
    recipient: address,
    destroyed_by: address,
    final_state: u8,
}

// === Entry Functions ===

/// Creator deposits an item and specifies the coin type and minimum amount expected.
/// Validates: creator ≠ recipient, timeout in bounds, description length, amount > 0.
public fun create_swap<T: key + store, CoinType>(
    item: T,
    recipient: address,
    requested_amount: u64,
    description: String,
    timeout_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let creator = ctx.sender();
    assert!(creator != recipient, ECreatorIsRecipient);
    assert!(requested_amount > 0, EZeroAmount);
    assert!(timeout_ms >= MIN_TIMEOUT_MS, ETimeoutTooShort);
    assert!(timeout_ms <= MAX_TIMEOUT_MS, ETimeoutTooLong);
    assert!(description.length() <= MAX_DESCRIPTION_LEN, EDescriptionTooLong);

    let uid = object::new(ctx);
    let swap_id = uid.to_inner();
    let created_at = clock.timestamp_ms();

    let swap = Swap<T, CoinType> {
        id: uid,
        creator,
        recipient,
        item: option::some(item),
        requested_amount,
        description,
        state: STATE_PENDING,
        created_at,
        timeout_ms,
    };

    event::emit(SwapCreated {
        swap_id,
        creator,
        recipient,
        requested_amount,
        description,
        timeout_ms,
        created_at,
    });

    transfer::share_object(swap);
}

/// Recipient accepts the swap: pays Coin<CoinType> (≥ requested_amount),
/// atomically receives the deposited item.
/// Timeout does NOT block execution — by design, whoever gets ordered first by
/// consensus wins the race between execute and cancel.
public fun execute_swap<T: key + store, CoinType>(
    swap: &mut Swap<T, CoinType>,
    payment: Coin<CoinType>,
    ctx: &TxContext,
) {
    assert!(swap.state == STATE_PENDING, EInvalidState);
    assert!(ctx.sender() == swap.recipient, ENotAuthorized);
    assert!(payment.value() >= swap.requested_amount, EInsufficientAmount);

    swap.state = STATE_EXECUTED;

    let amount_paid = payment.value();
    let item = swap.item.extract();
    transfer::public_transfer(item, swap.recipient);
    transfer::public_transfer(payment, swap.creator);

    event::emit(SwapExecuted {
        swap_id: swap.id.to_inner(),
        creator: swap.creator,
        recipient: swap.recipient,
        requested_amount: swap.requested_amount,
        amount_paid,
    });
}

/// Creator reclaims their asset after timeout. State must be Pending, clock must exceed deadline.
public fun cancel_swap<T: key + store, CoinType>(
    swap: &mut Swap<T, CoinType>,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(swap.state == STATE_PENDING, EInvalidState);
    assert!(ctx.sender() == swap.creator, ENotAuthorized);
    assert!(
        clock.timestamp_ms() >= swap.created_at + swap.timeout_ms,
        ETimeoutNotReached,
    );

    swap.state = STATE_CANCELLED;

    let item = swap.item.extract();
    transfer::public_transfer(item, swap.creator);

    event::emit(SwapCancelled {
        swap_id: swap.id.to_inner(),
        creator: swap.creator,
        recipient: swap.recipient,
    });
}

/// Destroy a terminal-state Swap, recovering on-chain storage.
/// Callable by anyone; state must be Executed or Cancelled (item already extracted).
public fun destroy_swap<T: key + store, CoinType>(
    swap: Swap<T, CoinType>,
    ctx: &TxContext,
) {
    assert!(
        swap.state == STATE_EXECUTED || swap.state == STATE_CANCELLED,
        EInvalidState,
    );

    let swap_id = swap.id.to_inner();
    let destroyed_by = ctx.sender();
    let final_state = swap.state;
    let creator = swap.creator;
    let recipient = swap.recipient;

    let Swap {
        id,
        creator: _,
        recipient: _,
        item,
        requested_amount: _,
        description: _,
        state: _,
        created_at: _,
        timeout_ms: _,
    } = swap;

    item.destroy_none();

    event::emit(SwapDestroyed {
        swap_id,
        creator,
        recipient,
        destroyed_by,
        final_state,
    });

    id.delete();
}

// === View Functions ===

public fun swap_id<T: key + store, CoinType>(swap: &Swap<T, CoinType>): ID {
    swap.id.to_inner()
}

public fun creator<T: key + store, CoinType>(swap: &Swap<T, CoinType>): address {
    swap.creator
}

public fun recipient<T: key + store, CoinType>(swap: &Swap<T, CoinType>): address {
    swap.recipient
}

public fun requested_amount<T: key + store, CoinType>(swap: &Swap<T, CoinType>): u64 {
    swap.requested_amount
}

public fun description<T: key + store, CoinType>(swap: &Swap<T, CoinType>): String {
    swap.description
}

public fun state<T: key + store, CoinType>(swap: &Swap<T, CoinType>): u8 {
    swap.state
}

public fun created_at<T: key + store, CoinType>(swap: &Swap<T, CoinType>): u64 {
    swap.created_at
}

public fun timeout_ms<T: key + store, CoinType>(swap: &Swap<T, CoinType>): u64 {
    swap.timeout_ms
}

public fun has_item<T: key + store, CoinType>(swap: &Swap<T, CoinType>): bool {
    swap.item.is_some()
}

public fun deadline<T: key + store, CoinType>(swap: &Swap<T, CoinType>): u64 {
    swap.created_at + swap.timeout_ms
}

// === Test Helpers ===

#[test_only]
use std::string;
#[test_only]
use sui::test_scenario as ts;
#[test_only]
use sui::clock;
#[test_only]
use sui::coin;
#[test_only]
use sui::sui::SUI;

#[test_only]
public struct TestNFT has key, store {
    id: UID,
    value: u64,
}

#[test_only]
fun create_test_nft(value: u64, ctx: &mut TxContext): TestNFT {
    TestNFT { id: object::new(ctx), value }
}

// === Unit Tests ===

/// Happy path: create -> recipient pays Coin<SUI> -> creator gets coin, recipient gets NFT
#[test]
fun test_happy_path() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"Swap NFT for 1000 MIST"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient executes the swap with sufficient payment
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);

        assert!(swap.state() == STATE_PENDING);
        assert!(swap.creator() == creator_addr);
        assert!(swap.recipient() == recipient_addr);
        assert!(swap.requested_amount() == 1000);
        assert!(swap.timeout_ms() == MIN_TIMEOUT_MS);
        assert!(swap.has_item() == true);

        let payment = coin::mint_for_testing<SUI>(1000, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));

        assert!(swap.state() == STATE_EXECUTED);
        assert!(swap.has_item() == false);

        ts::return_shared(swap);
    };

    // Verify: recipient received the NFT
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let nft = ts::take_from_sender<TestNFT>(&scenario);
        assert!(nft.value == 1);
        ts::return_to_sender(&scenario, nft);
    };

    // Verify: creator received the Coin<SUI>
    ts::next_tx(&mut scenario, creator_addr);
    {
        let payment = ts::take_from_sender<Coin<SUI>>(&scenario);
        assert!(payment.value() == 1000);
        ts::return_to_sender(&scenario, payment);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Overpayment: recipient pays more than requested — full amount goes to creator
#[test]
fun test_overpayment() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(7, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        500,
        string::utf8(b"NFT for >= 500 MIST"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        let payment = coin::mint_for_testing<SUI>(2000, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Creator receives the full overpayment
    ts::next_tx(&mut scenario, creator_addr);
    {
        let payment = ts::take_from_sender<Coin<SUI>>(&scenario);
        assert!(payment.value() == 2000);
        ts::return_to_sender(&scenario, payment);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Timeout path: create -> advance clock past timeout -> cancel -> creator gets NFT back
#[test]
fun test_timeout_path() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(42, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test swap"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Advance clock past timeout
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS);

    // Creator cancels
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        assert!(swap.state() == STATE_CANCELLED);
        ts::return_shared(swap);
    };

    // Verify: creator got NFT back
    ts::next_tx(&mut scenario, creator_addr);
    {
        let nft = ts::take_from_sender<TestNFT>(&scenario);
        assert!(nft.value == 42);
        ts::return_to_sender(&scenario, nft);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: payment below requested_amount
#[test]
#[expected_failure(abort_code = EInsufficientAmount)]
fun test_execute_swap_insufficient_amount() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"NFT for 1000 MIST"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient tries to pay less than requested
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        let payment = coin::mint_for_testing<SUI>(999, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: requested_amount is zero
#[test]
#[expected_failure(abort_code = EZeroAmount)]
fun test_create_swap_zero_amount() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        0,
        string::utf8(b"free?"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: unauthorized caller (not the designated recipient) tries execute_swap
#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_error_unauthorized_execute() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let unauthorized = @0xC;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Unauthorized user tries to execute
    ts::next_tx(&mut scenario, unauthorized);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        let payment = coin::mint_for_testing<SUI>(1000, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: wrong state — execute on a Cancelled swap
#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_error_wrong_state() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Cancel the swap first
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS);
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Attempt execute on the now-Cancelled swap
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        let payment = coin::mint_for_testing<SUI>(1000, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: timeout not reached — creator tries to cancel before deadline
#[test]
#[expected_failure(abort_code = ETimeoutNotReached)]
fun test_error_timeout_not_reached() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Try to cancel immediately without advancing clock
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: creator and recipient are the same address
#[test]
#[expected_failure(abort_code = ECreatorIsRecipient)]
fun test_error_creator_is_recipient() {
    let creator_addr = @0xA;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        creator_addr, // same as sender — should abort
        1000,
        string::utf8(b"self-swap"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Timeout race: execute_swap after timeout still succeeds — consensus ordering wins
#[test]
fun test_timeout_race_execute_succeeds() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Advance past timeout — execute should still work
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS + 1);

    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        let payment = coin::mint_for_testing<SUI>(1000, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));
        assert!(swap.state() == STATE_EXECUTED);
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Timeout race: cancel after execute fails — state is already Executed
#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_timeout_race_cancel_after_execute() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient executes first
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        let payment = coin::mint_for_testing<SUI>(1000, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Creator tries to cancel after execute — should fail
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS + 1);
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Destroy terminal: destroy in Executed state succeeds
#[test]
fun test_destroy_executed() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Execute
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        let payment = coin::mint_for_testing<SUI>(1000, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Destroy — callable by anyone
    ts::next_tx(&mut scenario, @0xC);
    {
        let swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        destroy_swap(swap, ts::ctx(&mut scenario));
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Destroy terminal: destroy in Cancelled state succeeds
#[test]
fun test_destroy_cancelled() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Cancel after timeout
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS);
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Destroy — callable by anyone
    ts::next_tx(&mut scenario, @0xC);
    {
        let swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        destroy_swap(swap, ts::ctx(&mut scenario));
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Destroy terminal: destroy in Pending state fails
#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_destroy_pending_fails() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Try to destroy while still Pending
    ts::next_tx(&mut scenario, @0xC);
    {
        let swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        destroy_swap(swap, ts::ctx(&mut scenario));
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: timeout below MIN_TIMEOUT_MS
#[test]
#[expected_failure(abort_code = ETimeoutTooShort)]
fun test_error_timeout_too_short() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS - 1,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: timeout above MAX_TIMEOUT_MS
#[test]
#[expected_failure(abort_code = ETimeoutTooLong)]
fun test_error_timeout_too_long() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MAX_TIMEOUT_MS + 1,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: description exceeds MAX_DESCRIPTION_LEN
#[test]
#[expected_failure(abort_code = EDescriptionTooLong)]
fun test_error_description_too_long() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    // Build a description of 1025 bytes (one over the limit)
    let mut desc = vector[];
    let mut i = 0;
    while (i <= MAX_DESCRIPTION_LEN) {
        desc.push_back(65u8);
        i = i + 1;
    };

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(desc),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: unauthorized caller (recipient) tries cancel_swap
#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_error_unauthorized_cancel() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Advance clock past timeout so timeout is not the failure reason
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS);

    // Recipient tries to cancel — should fail with ENotAuthorized
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: double-execute — execute on an already-Executed swap
#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_execute_swap_already_executed() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Execute first time
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        let payment = coin::mint_for_testing<SUI>(1000, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Attempt second execution — should fail with EInvalidState
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        let payment = coin::mint_for_testing<SUI>(1000, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: double-cancel — cancel on an already-Cancelled swap
#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_cancel_swap_already_cancelled() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Cancel first time
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS);
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Attempt second cancellation — should fail with EInvalidState
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Boundary: create_swap with exactly MAX_TIMEOUT_MS succeeds
#[test]
fun test_create_swap_max_timeout() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"max timeout"),
        MAX_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Verify the swap was created with the correct timeout
    ts::next_tx(&mut scenario, creator_addr);
    {
        let swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        assert!(swap.timeout_ms() == MAX_TIMEOUT_MS);
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: cancel at exactly deadline - 1 should fail (boundary condition)
#[test]
#[expected_failure(abort_code = ETimeoutNotReached)]
fun test_error_timeout_boundary_one_ms_before() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, SUI>(
        nft,
        recipient_addr,
        1000,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Advance clock to exactly 1ms before the deadline
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS - 1);

    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, SUI>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}
