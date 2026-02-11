/// Trustless Atomic Swap module: A deposits T, B deposits U to atomically exchange.
/// B's deposit and execution are merged into one step — B's asset never enters
/// a "locked but unexecuted" limbo, eliminating counterparty risk for B.
module gavel::swap;

use std::string::String;
use sui::event;
use sui::clock::Clock;

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

// === Core Struct ===

/// `phantom U` encodes the expected counter-asset type at the type level.
/// Move enforces B provides exactly this type at execute_swap, without storing U on-chain.
public struct Swap<T: key + store, phantom U: key + store> has key {
    id: UID,
    creator: address,
    recipient: address,
    /// Creator's deposited asset.
    /// Invariant: Some when state == Pending; None after execute/cancel extracts it.
    item_a: Option<T>,
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
    description: String,
    timeout_ms: u64,
    created_at: u64,
}

public struct SwapExecuted has copy, drop {
    swap_id: ID,
    creator: address,
    recipient: address,
}

public struct SwapCancelled has copy, drop {
    swap_id: ID,
    creator: address,
}

public struct SwapDestroyed has copy, drop {
    swap_id: ID,
    destroyed_by: address,
}

// === Entry Functions ===

/// A creates a swap offer: deposits item_a, specifies who can fill and what type is expected.
/// Validates: creator ≠ recipient, timeout ≥ MIN_TIMEOUT_MS, timeout ≤ MAX_TIMEOUT_MS,
///            description ≤ MAX_DESCRIPTION_LEN.
public fun create_swap<T: key + store, U: key + store>(
    item: T,
    recipient: address,
    description: String,
    timeout_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let creator = ctx.sender();
    assert!(creator != recipient, ECreatorIsRecipient);
    assert!(timeout_ms >= MIN_TIMEOUT_MS, ETimeoutTooShort);
    assert!(timeout_ms <= MAX_TIMEOUT_MS, ETimeoutTooLong);
    assert!(description.length() <= MAX_DESCRIPTION_LEN, EDescriptionTooLong);

    let uid = object::new(ctx);
    let swap_id = object::uid_to_inner(&uid);
    let created_at = clock.timestamp_ms();

    let swap = Swap<T, U> {
        id: uid,
        creator,
        recipient,
        item_a: option::some(item),
        description,
        state: STATE_PENDING,
        created_at,
        timeout_ms,
    };

    transfer::share_object(swap);

    event::emit(SwapCreated {
        swap_id,
        creator,
        recipient,
        description,
        timeout_ms,
        created_at,
    });
}

/// B accepts the swap: deposits item_b of type U, atomically receives item_a of type T.
/// Caller must be the designated recipient. State must be Pending.
/// Timeout does NOT block execution — by design, whoever gets ordered first by
/// consensus wins the race between execute and cancel.
public fun execute_swap<T: key + store, U: key + store>(
    swap: &mut Swap<T, U>,
    item_b: U,
    ctx: &TxContext,
) {
    assert!(swap.state == STATE_PENDING, EInvalidState);
    assert!(ctx.sender() == swap.recipient, ENotAuthorized);

    let item_a = swap.item_a.extract();
    transfer::public_transfer(item_a, swap.recipient);
    transfer::public_transfer(item_b, swap.creator);

    swap.state = STATE_EXECUTED;

    event::emit(SwapExecuted {
        swap_id: object::id(swap),
        creator: swap.creator,
        recipient: swap.recipient,
    });
}

/// Creator reclaims their asset after timeout. State must be Pending, clock must exceed deadline.
public fun cancel_swap<T: key + store, U: key + store>(
    swap: &mut Swap<T, U>,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(swap.state == STATE_PENDING, EInvalidState);
    assert!(ctx.sender() == swap.creator, ENotAuthorized);
    assert!(
        clock.timestamp_ms() >= swap.created_at + swap.timeout_ms,
        ETimeoutNotReached,
    );

    let item_a = swap.item_a.extract();
    transfer::public_transfer(item_a, swap.creator);

    swap.state = STATE_CANCELLED;

    event::emit(SwapCancelled {
        swap_id: object::id(swap),
        creator: swap.creator,
    });
}

/// Destroy a terminal-state Swap, recovering on-chain storage.
/// Callable by anyone; state must be Executed or Cancelled (item already extracted).
public fun destroy_swap<T: key + store, U: key + store>(
    swap: Swap<T, U>,
    ctx: &TxContext,
) {
    assert!(
        swap.state == STATE_EXECUTED || swap.state == STATE_CANCELLED,
        EInvalidState,
    );

    let swap_id = object::id(&swap);
    let destroyed_by = ctx.sender();

    let Swap {
        id,
        creator: _,
        recipient: _,
        item_a,
        description: _,
        state: _,
        created_at: _,
        timeout_ms: _,
    } = swap;

    item_a.destroy_none();

    event::emit(SwapDestroyed {
        swap_id,
        destroyed_by,
    });

    id.delete();
}

// === View Functions ===

public fun swap_id<T: key + store, U: key + store>(swap: &Swap<T, U>): ID {
    object::id(swap)
}

public fun creator<T: key + store, U: key + store>(swap: &Swap<T, U>): address {
    swap.creator
}

public fun recipient<T: key + store, U: key + store>(swap: &Swap<T, U>): address {
    swap.recipient
}

public fun description<T: key + store, U: key + store>(swap: &Swap<T, U>): String {
    swap.description
}

public fun state<T: key + store, U: key + store>(swap: &Swap<T, U>): u8 {
    swap.state
}

public fun created_at<T: key + store, U: key + store>(swap: &Swap<T, U>): u64 {
    swap.created_at
}

public fun timeout_ms<T: key + store, U: key + store>(swap: &Swap<T, U>): u64 {
    swap.timeout_ms
}

// === Test Helpers ===

#[test_only]
use std::string;
#[test_only]
use sui::test_scenario as ts;
#[test_only]
use sui::clock;
#[test_only]
use sui::coin::{Self, Coin};
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

/// Happy path: create -> execute -> A gets NFT_B, B gets NFT_A
#[test]
fun test_happy_path() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft_a = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, TestNFT>(
        nft_a,
        recipient_addr,
        string::utf8(b"Swap NFT A for NFT B"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient executes the swap
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));

        // Verify initial state via view functions
        assert!(swap.state() == STATE_PENDING);
        assert!(swap.creator() == creator_addr);
        assert!(swap.recipient() == recipient_addr);
        assert!(swap.timeout_ms() == MIN_TIMEOUT_MS);

        execute_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
        assert!(swap.state() == STATE_EXECUTED);

        ts::return_shared(swap);
    };

    // Verify: recipient received NFT_A (value=1)
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let nft = ts::take_from_sender<TestNFT>(&scenario);
        assert!(nft.value == 1);
        ts::return_to_sender(&scenario, nft);
    };

    // Verify: creator received NFT_B (value=2)
    ts::next_tx(&mut scenario, creator_addr);
    {
        let nft = ts::take_from_sender<TestNFT>(&scenario);
        assert!(nft.value == 2);
        ts::return_to_sender(&scenario, nft);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Timeout path: create -> advance clock past timeout -> cancel -> A gets NFT back
#[test]
fun test_timeout_path() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(42, ts::ctx(&mut scenario));

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
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
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
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

/// Mixed types: create_swap<NFT, Coin<SUI>> -> execute with Coin -> cross-type swap
#[test]
fun test_mixed_types() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(42, ts::ctx(&mut scenario));

    create_swap<TestNFT, Coin<SUI>>(
        nft,
        recipient_addr,
        string::utf8(b"NFT for 1000 MIST"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient deposits Coin<SUI>
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, Coin<SUI>>>(&scenario);
        let payment = coin::mint_for_testing<SUI>(1000, ts::ctx(&mut scenario));
        execute_swap(&mut swap, payment, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Verify: recipient got NFT
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let nft = ts::take_from_sender<TestNFT>(&scenario);
        assert!(nft.value == 42);
        ts::return_to_sender(&scenario, nft);
    };

    // Verify: creator got Coin<SUI>
    ts::next_tx(&mut scenario, creator_addr);
    {
        let payment = ts::take_from_sender<Coin<SUI>>(&scenario);
        assert!(payment.value() == 1000);
        ts::return_to_sender(&scenario, payment);
    };

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

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Unauthorized user tries to execute
    ts::next_tx(&mut scenario, unauthorized);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));
        execute_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
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

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Cancel the swap first
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS);
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Attempt execute on the now-Cancelled swap
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));
        execute_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
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

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Try to cancel immediately without advancing clock
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
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

    create_swap<TestNFT, TestNFT>(
        nft,
        creator_addr, // same as sender — should abort
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
    let nft_a = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, TestNFT>(
        nft_a,
        recipient_addr,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Advance past timeout — execute should still work
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS + 1);

    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));
        execute_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
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
    let nft_a = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, TestNFT>(
        nft_a,
        recipient_addr,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient executes first
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));
        execute_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Creator tries to cancel after execute — should fail
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS + 1);
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
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
    let nft_a = create_test_nft(1, ts::ctx(&mut scenario));

    create_swap<TestNFT, TestNFT>(
        nft_a,
        recipient_addr,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Execute
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));
        execute_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Destroy — callable by anyone
    ts::next_tx(&mut scenario, @0xC);
    {
        let swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
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

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Cancel after timeout
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS);
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Destroy — callable by anyone
    ts::next_tx(&mut scenario, @0xC);
    {
        let swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
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

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Try to destroy while still Pending
    ts::next_tx(&mut scenario, @0xC);
    {
        let swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
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

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
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

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
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

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
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

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
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
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
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

    create_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Advance clock to exactly 1ms before the deadline
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS - 1);

    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<Swap<TestNFT, TestNFT>>(&scenario);
        cancel_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}
