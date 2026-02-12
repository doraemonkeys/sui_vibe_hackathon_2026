/// Object-for-Object Atomic Swap: Creator deposits object T, Recipient provides object U.
/// Optionally requests a specific object by ID, or accepts any object of type U.
/// Mirrors gavel::swap's state machine, but both sides are arbitrary objects.
module gavel::object_swap;

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
const EItemAlreadyExtracted: vector<u8> = b"Item has already been extracted";
#[error]
const EObjectMismatch: vector<u8> = b"Provided object does not match the requested object ID";
#[error]
const ECreatorIsRecipient: vector<u8> = b"Creator and recipient must be different addresses";
#[error]
const ETimeoutTooShort: vector<u8> = b"Timeout must be at least MIN_TIMEOUT_MS";
#[error]
const ETimeoutTooLong: vector<u8> = b"Timeout must be at most MAX_TIMEOUT_MS";
#[error]
const EDescriptionTooLong: vector<u8> = b"Description exceeds MAX_DESCRIPTION_LEN";

// === Core Struct ===

/// NFT-for-NFT swap. `phantom U` encodes the counter-asset type at the type level.
/// If `requested_object_id` is Some, execution enforces exact NFT match;
/// if None, any object of type U satisfies the swap.
public struct ObjectSwap<T: key + store, phantom U: key + store> has key {
    id: UID,
    creator: address,
    recipient: address,
    /// Creator's deposited asset.
    /// Invariant: Some when state == Pending; None after execute/cancel extracts it.
    item: Option<T>,
    /// If Some, require the recipient to provide this exact object; if None, accept any U.
    requested_object_id: Option<ID>,
    description: String,
    state: u8,
    created_at: u64,
    timeout_ms: u64,
}

// === Events ===

public struct ObjectSwapCreated has copy, drop {
    swap_id: ID,
    creator: address,
    recipient: address,
    requested_object_id: Option<ID>,
    description: String,
    timeout_ms: u64,
    created_at: u64,
}

public struct ObjectSwapExecuted has copy, drop {
    swap_id: ID,
    creator: address,
    recipient: address,
    item_a_id: ID,
    item_b_id: ID,
}

public struct ObjectSwapCancelled has copy, drop {
    swap_id: ID,
    creator: address,
}

public struct ObjectSwapDestroyed has copy, drop {
    swap_id: ID,
    destroyed_by: address,
}

// === Entry Functions ===

/// Creator deposits item T, specifies recipient, optional requested_object_id,
/// description, and timeout. Creates a shared ObjectSwap.
/// Validates: creator ≠ recipient, timeout ∈ [MIN, MAX], description ≤ MAX_DESCRIPTION_LEN.
public fun create_object_swap<T: key + store, U: key + store>(
    item: T,
    recipient: address,
    requested_object_id: Option<ID>,
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
    let swap_id = uid.to_inner();
    let created_at = clock.timestamp_ms();

    let swap = ObjectSwap<T, U> {
        id: uid,
        creator,
        recipient,
        item: option::some(item),
        requested_object_id,
        description,
        state: STATE_PENDING,
        created_at,
        timeout_ms,
    };

    event::emit(ObjectSwapCreated {
        swap_id,
        creator,
        recipient,
        requested_object_id,
        description,
        timeout_ms,
        created_at,
    });

    transfer::share_object(swap);
}

/// Recipient provides object of type U. If `requested_object_id` is Some(id),
/// the provided object must have that exact ID (aborts with EObjectMismatch otherwise).
/// Transfers creator's item to recipient, recipient's item to creator.
/// Timeout does NOT block execution — consensus ordering wins the race.
public fun execute_object_swap<T: key + store, U: key + store>(
    swap: &mut ObjectSwap<T, U>,
    item_b: U,
    ctx: &TxContext,
) {
    assert!(swap.state == STATE_PENDING, EInvalidState);
    assert!(ctx.sender() == swap.recipient, ENotAuthorized);
    assert!(swap.item.is_some(), EItemAlreadyExtracted);

    if (swap.requested_object_id.is_some()) {
        assert!(
            object::id(&item_b) == *swap.requested_object_id.borrow(),
            EObjectMismatch,
        );
    };

    swap.state = STATE_EXECUTED;

    let item_a = swap.item.extract();
    let item_a_id = object::id(&item_a);
    let item_b_id = object::id(&item_b);
    transfer::public_transfer(item_a, swap.recipient);
    transfer::public_transfer(item_b, swap.creator);

    event::emit(ObjectSwapExecuted {
        swap_id: swap.id.to_inner(),
        creator: swap.creator,
        recipient: swap.recipient,
        item_a_id,
        item_b_id,
    });
}

/// Creator reclaims their asset after timeout. State must be Pending, clock must exceed deadline.
public fun cancel_object_swap<T: key + store, U: key + store>(
    swap: &mut ObjectSwap<T, U>,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(swap.state == STATE_PENDING, EInvalidState);
    assert!(ctx.sender() == swap.creator, ENotAuthorized);
    assert!(
        clock.timestamp_ms() >= swap.created_at + swap.timeout_ms,
        ETimeoutNotReached,
    );
    assert!(swap.item.is_some(), EItemAlreadyExtracted);

    swap.state = STATE_CANCELLED;

    let item = swap.item.extract();
    transfer::public_transfer(item, swap.creator);

    event::emit(ObjectSwapCancelled {
        swap_id: swap.id.to_inner(),
        creator: swap.creator,
    });
}

/// Destroy a terminal-state ObjectSwap, recovering on-chain storage.
/// Callable by anyone; state must be Executed or Cancelled (item already extracted).
public fun destroy_object_swap<T: key + store, U: key + store>(
    swap: ObjectSwap<T, U>,
    ctx: &TxContext,
) {
    assert!(
        swap.state == STATE_EXECUTED || swap.state == STATE_CANCELLED,
        EInvalidState,
    );

    let swap_id = swap.id.to_inner();
    let destroyed_by = ctx.sender();

    let ObjectSwap {
        id,
        creator: _,
        recipient: _,
        item,
        requested_object_id: _,
        description: _,
        state: _,
        created_at: _,
        timeout_ms: _,
    } = swap;

    item.destroy_none();

    event::emit(ObjectSwapDestroyed {
        swap_id,
        destroyed_by,
    });

    id.delete();
}

// === View Functions ===

public fun swap_id<T: key + store, U: key + store>(swap: &ObjectSwap<T, U>): ID {
    swap.id.to_inner()
}

public fun creator<T: key + store, U: key + store>(swap: &ObjectSwap<T, U>): address {
    swap.creator
}

public fun recipient<T: key + store, U: key + store>(swap: &ObjectSwap<T, U>): address {
    swap.recipient
}

public fun description<T: key + store, U: key + store>(swap: &ObjectSwap<T, U>): String {
    swap.description
}

public fun state<T: key + store, U: key + store>(swap: &ObjectSwap<T, U>): u8 {
    swap.state
}

public fun created_at<T: key + store, U: key + store>(swap: &ObjectSwap<T, U>): u64 {
    swap.created_at
}

public fun timeout_ms<T: key + store, U: key + store>(swap: &ObjectSwap<T, U>): u64 {
    swap.timeout_ms
}

public fun has_item<T: key + store, U: key + store>(swap: &ObjectSwap<T, U>): bool {
    swap.item.is_some()
}

public fun requested_object_id<T: key + store, U: key + store>(
    swap: &ObjectSwap<T, U>,
): Option<ID> {
    swap.requested_object_id
}

// === Test Helpers ===

#[test_only]
use std::string;
#[test_only]
use sui::test_scenario as ts;
#[test_only]
use sui::clock;

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

/// Happy path: create -> execute -> verify transfers -> destroy (full lifecycle)
#[test]
fun test_object_swap_lifecycle() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft_a = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft_a,
        recipient_addr,
        option::none(),
        string::utf8(b"Swap my NFT for yours"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient executes the swap
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));

        // Verify initial state via view functions
        assert!(swap.state() == STATE_PENDING);
        assert!(swap.creator() == creator_addr);
        assert!(swap.recipient() == recipient_addr);
        assert!(swap.has_item());
        assert!(swap.timeout_ms() == MIN_TIMEOUT_MS);

        execute_object_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
        assert!(swap.state() == STATE_EXECUTED);
        assert!(!swap.has_item());

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

    // Destroy the completed swap — callable by anyone
    ts::next_tx(&mut scenario, @0xC);
    {
        let swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        destroy_object_swap(swap, ts::ctx(&mut scenario));
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Specific ID: create with requested_object_id = Some(target_id), execute with that exact object
#[test]
fun test_object_swap_with_specific_id() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));

    // Create the target NFT and note its ID, then transfer to recipient
    let target_nft = create_test_nft(99, ts::ctx(&mut scenario));
    let target_id = object::id(&target_nft);
    transfer::public_transfer(target_nft, recipient_addr);

    // Creator creates swap requesting that specific NFT
    let nft_a = create_test_nft(1, ts::ctx(&mut scenario));
    create_object_swap<TestNFT, TestNFT>(
        nft_a,
        recipient_addr,
        option::some(target_id),
        string::utf8(b"Want your specific NFT"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient executes with the specific NFT
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        assert!(swap.requested_object_id() == option::some(target_id));

        let nft_b = ts::take_from_sender<TestNFT>(&scenario);
        execute_object_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
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

    // Verify: creator received target NFT (value=99)
    ts::next_tx(&mut scenario, creator_addr);
    {
        let nft = ts::take_from_sender<TestNFT>(&scenario);
        assert!(nft.value == 99);
        ts::return_to_sender(&scenario, nft);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: requested_object_id is Some but recipient provides a different object
#[test]
#[expected_failure(abort_code = EObjectMismatch)]
fun test_object_swap_wrong_object() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));

    // Create the target NFT and note its ID
    let target_nft = create_test_nft(99, ts::ctx(&mut scenario));
    let target_id = object::id(&target_nft);
    transfer::public_transfer(target_nft, recipient_addr);

    let nft_a = create_test_nft(1, ts::ctx(&mut scenario));
    create_object_swap<TestNFT, TestNFT>(
        nft_a,
        recipient_addr,
        option::some(target_id),
        string::utf8(b"Want specific NFT"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient tries with a DIFFERENT NFT — should abort with EObjectMismatch
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        let wrong_nft = create_test_nft(77, ts::ctx(&mut scenario));
        execute_object_swap(&mut swap, wrong_nft, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Any object: create with requested_object_id = None, any U satisfies the swap
#[test]
fun test_object_swap_any_object() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft_a = create_test_nft(10, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft_a,
        recipient_addr,
        option::none(),
        string::utf8(b"Any NFT will do"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient provides any NFT — no ID restriction
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        assert!(swap.requested_object_id() == option::none());

        let nft_b = create_test_nft(20, ts::ctx(&mut scenario));
        execute_object_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
        assert!(swap.state() == STATE_EXECUTED);
        ts::return_shared(swap);
    };

    // Verify: recipient received NFT_A (value=10)
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let nft = ts::take_from_sender<TestNFT>(&scenario);
        assert!(nft.value == 10);
        ts::return_to_sender(&scenario, nft);
    };

    // Verify: creator received NFT_B (value=20)
    ts::next_tx(&mut scenario, creator_addr);
    {
        let nft = ts::take_from_sender<TestNFT>(&scenario);
        assert!(nft.value == 20);
        ts::return_to_sender(&scenario, nft);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Timeout path: create -> advance clock past timeout -> cancel -> creator gets NFT back
#[test]
fun test_object_swap_cancel_after_timeout() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(42, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
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
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        cancel_object_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        assert!(swap.state() == STATE_CANCELLED);
        assert!(!swap.has_item());
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

/// Error: cancel before timeout — should abort with ETimeoutNotReached
#[test]
#[expected_failure(abort_code = ETimeoutNotReached)]
fun test_object_swap_cancel_before_timeout() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Try to cancel immediately without advancing clock
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        cancel_object_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: unauthorized caller (not the designated recipient) tries execute
#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_object_swap_not_recipient() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let unauthorized = @0xC;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Unauthorized user tries to execute
    ts::next_tx(&mut scenario, unauthorized);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));
        execute_object_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: unauthorized caller (recipient) tries cancel — only creator can cancel
#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_object_swap_not_creator_cancel() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
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
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        cancel_object_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: execute on an already-executed swap — should abort with EInvalidState
#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_object_swap_double_execute() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft_a = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft_a,
        recipient_addr,
        option::none(),
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // First execute succeeds
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));
        execute_object_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Second execute fails — state is already Executed
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        let nft_b2 = create_test_nft(3, ts::ctx(&mut scenario));
        execute_object_swap(&mut swap, nft_b2, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: destroy a Pending swap — should abort with EInvalidState
#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_object_swap_destroy_pending() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Try to destroy while still Pending
    ts::next_tx(&mut scenario, @0xC);
    {
        let swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        destroy_object_swap(swap, ts::ctx(&mut scenario));
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: creator and recipient are the same address
#[test]
#[expected_failure(abort_code = ECreatorIsRecipient)]
fun test_create_object_swap_self_swap() {
    let creator_addr = @0xA;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        creator_addr, // same as sender — should abort
        option::none(),
        string::utf8(b"self-swap"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: timeout below MIN_TIMEOUT_MS
#[test]
#[expected_failure(abort_code = ETimeoutTooShort)]
fun test_create_object_swap_timeout_too_short() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
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
fun test_create_object_swap_timeout_too_long() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
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
fun test_create_object_swap_description_too_long() {
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

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
        string::utf8(desc),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Timeout race: execute_object_swap after timeout still succeeds — consensus ordering wins
#[test]
fun test_execute_after_timeout() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Advance past timeout — execute should still work
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS + 1);

    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));
        execute_object_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
        assert!(swap.state() == STATE_EXECUTED);
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Timeout race: cancel after execute fails — state is already Executed
#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_cancel_after_execute() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Recipient executes first
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));
        execute_object_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Creator tries to cancel after execute — should fail
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS + 1);
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        cancel_object_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Destroy terminal: destroy in Cancelled state succeeds
#[test]
fun test_destroy_cancelled_object_swap() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Cancel after timeout
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS);
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        cancel_object_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Destroy — callable by anyone
    ts::next_tx(&mut scenario, @0xC);
    {
        let swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        destroy_object_swap(swap, ts::ctx(&mut scenario));
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: execute on a Cancelled swap — should abort with EInvalidState
#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_execute_cancelled_object_swap() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Cancel the swap first
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS);
    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        cancel_object_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    // Attempt execute on the now-Cancelled swap
    ts::next_tx(&mut scenario, recipient_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        let nft_b = create_test_nft(2, ts::ctx(&mut scenario));
        execute_object_swap(&mut swap, nft_b, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}

/// Error: cancel at exactly deadline - 1ms should fail (boundary condition)
#[test]
#[expected_failure(abort_code = ETimeoutNotReached)]
fun test_create_object_swap_min_timeout_boundary() {
    let creator_addr = @0xA;
    let recipient_addr = @0xB;
    let mut scenario = ts::begin(creator_addr);

    let mut clock_obj = clock::create_for_testing(ts::ctx(&mut scenario));
    let nft = create_test_nft(1, ts::ctx(&mut scenario));

    create_object_swap<TestNFT, TestNFT>(
        nft,
        recipient_addr,
        option::none(),
        string::utf8(b"test"),
        MIN_TIMEOUT_MS,
        &clock_obj,
        ts::ctx(&mut scenario),
    );

    // Advance clock to exactly 1ms before the deadline
    clock::increment_for_testing(&mut clock_obj, MIN_TIMEOUT_MS - 1);

    ts::next_tx(&mut scenario, creator_addr);
    {
        let mut swap = ts::take_shared<ObjectSwap<TestNFT, TestNFT>>(&scenario);
        cancel_object_swap(&mut swap, &clock_obj, ts::ctx(&mut scenario));
        ts::return_shared(swap);
    };

    clock::destroy_for_testing(clock_obj);
    ts::end(scenario);
}
