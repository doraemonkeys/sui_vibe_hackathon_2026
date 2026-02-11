module gavel::escrow;

// === Imports ===

use std::string::String;
use sui::event;
use sui::clock::Clock;

// === State Constants ===

const STATE_ACTIVE: u8 = 0;
const STATE_DISPUTED: u8 = 1;
const STATE_RELEASED: u8 = 2;
const STATE_REFUNDED: u8 = 3;

// === Configuration Constants ===

const MIN_TIMEOUT_MS: u64 = 300_000;       // 5 minutes
const MAX_TIMEOUT_MS: u64 = 2_592_000_000; // 30 days
const DISPUTE_TIMEOUT_MS: u64 = 2_592_000_000; // 30 days — arbiter resolution deadline
const MAX_DESCRIPTION_BYTES: u64 = 1024;

// === Error Constants ===

#[error]
const ENotAuthorized: vector<u8> = b"Caller is not authorized";
#[error]
const EInvalidState: vector<u8> = b"Escrow is not in the expected state";
#[error]
const ETimeoutNotReached: vector<u8> = b"Timeout has not been reached";
#[error]
const EAlreadyConfirmed: vector<u8> = b"Caller has already confirmed";
#[error]
const EInvalidArbiter: vector<u8> = b"Arbiter must differ from both creator and recipient";
#[error]
const ECreatorIsRecipient: vector<u8> = b"Creator and recipient must be different addresses";
#[error]
const ETimeoutTooShort: vector<u8> = b"Timeout must be at least MIN_TIMEOUT_MS";
#[error]
const ETimeoutTooLong: vector<u8> = b"Timeout must be at most MAX_TIMEOUT_MS";
#[error]
const EAlreadyConfirmedCannotDispute: vector<u8> = b"Cannot dispute after confirming";
#[error]
const EDescriptionTooLong: vector<u8> = b"Description exceeds MAX_DESCRIPTION_BYTES";

// === Events ===

public struct EscrowCreated has copy, drop {
    escrow_id: ID,
    creator: address,
    recipient: address,
    arbiter: address,
    description: String,
    timeout_ms: u64,
    item_id: ID,
}

public struct EscrowConfirmed has copy, drop {
    escrow_id: ID,
    confirmer: address,
}

public struct EscrowReleased has copy, drop {
    escrow_id: ID,
    recipient: address,
}

public struct EscrowRefunded has copy, drop {
    escrow_id: ID,
    creator: address,
}

public struct EscrowDisputed has copy, drop {
    escrow_id: ID,
    disputer: address,
}

public struct EscrowRejected has copy, drop {
    escrow_id: ID,
    recipient: address,
}

public struct ArbiterResolved has copy, drop {
    escrow_id: ID,
    arbiter: address,
    released: bool,
}

// === Core Struct ===

/// Single-direction asset escrow with mutual-confirm, timelock-refund, and arbiter-resolve.
/// Shared object (key only, no store) — cannot be transferred, only interacted with.
public struct Escrow<T: key + store> has key {
    id: UID,
    creator: address,
    recipient: address,
    arbiter: address,
    item: Option<T>,
    description: String,
    state: u8,
    created_at: u64,
    timeout_ms: u64,
    creator_confirmed: bool,
    recipient_confirmed: bool,
    disputed_at: u64,
}

// === Entry Functions ===

/// Creator deposits asset T and creates a shared Escrow with designated recipient and arbiter.
public fun create_and_share<T: key + store>(
    item: T,
    recipient: address,
    arbiter: address,
    description: String,
    timeout_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let creator = ctx.sender();
    assert!(creator != recipient, ECreatorIsRecipient);
    assert!(arbiter != creator && arbiter != recipient, EInvalidArbiter);
    assert!(timeout_ms >= MIN_TIMEOUT_MS, ETimeoutTooShort);
    assert!(timeout_ms <= MAX_TIMEOUT_MS, ETimeoutTooLong);
    assert!(description.length() <= MAX_DESCRIPTION_BYTES, EDescriptionTooLong);

    let uid = object::new(ctx);
    let escrow_id = uid.to_inner();
    let item_id = object::id(&item);

    let escrow = Escrow<T> {
        id: uid,
        creator,
        recipient,
        arbiter,
        item: option::some(item),
        description,
        state: STATE_ACTIVE,
        created_at: clock.timestamp_ms(),
        timeout_ms,
        creator_confirmed: false,
        recipient_confirmed: false,
        disputed_at: 0,
    };

    event::emit(EscrowCreated {
        escrow_id,
        creator,
        recipient,
        arbiter,
        description,
        timeout_ms,
        item_id,
    });

    transfer::share_object(escrow);
}

/// Creator or recipient confirms the deal.
/// If both parties have now confirmed, asset is auto-released to recipient.
/// On auto-release: emits both EscrowConfirmed and EscrowReleased events.
public fun confirm<T: key + store>(
    escrow: &mut Escrow<T>,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == escrow.creator || sender == escrow.recipient, ENotAuthorized);
    assert!(escrow.state == STATE_ACTIVE, EInvalidState);

    if (sender == escrow.creator) {
        assert!(!escrow.creator_confirmed, EAlreadyConfirmed);
        escrow.creator_confirmed = true;
    } else {
        assert!(!escrow.recipient_confirmed, EAlreadyConfirmed);
        escrow.recipient_confirmed = true;
    };

    let escrow_id = escrow.id.to_inner();
    event::emit(EscrowConfirmed { escrow_id, confirmer: sender });

    // Auto-release when both parties have confirmed
    if (escrow.creator_confirmed && escrow.recipient_confirmed) {
        escrow.state = STATE_RELEASED;
        let item = escrow.item.extract();
        transfer::public_transfer(item, escrow.recipient);

        event::emit(EscrowReleased { escrow_id, recipient: escrow.recipient });
    };
}

/// Creator or recipient raises a dispute, freezing the escrow for arbiter review.
/// Caller must not have already confirmed (prevents confirm-then-dispute attack).
public fun dispute<T: key + store>(
    escrow: &mut Escrow<T>,
    clock: &Clock,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == escrow.creator || sender == escrow.recipient, ENotAuthorized);
    assert!(escrow.state == STATE_ACTIVE, EInvalidState);

    if (sender == escrow.creator) {
        assert!(!escrow.creator_confirmed, EAlreadyConfirmedCannotDispute);
    } else {
        assert!(!escrow.recipient_confirmed, EAlreadyConfirmedCannotDispute);
    };

    escrow.state = STATE_DISPUTED;
    escrow.disputed_at = clock.timestamp_ms();

    event::emit(EscrowDisputed {
        escrow_id: escrow.id.to_inner(),
        disputer: sender,
    });
}

/// Arbiter resolves a disputed escrow.
/// release=true sends asset to recipient; release=false refunds asset to creator.
/// On release: emits EscrowReleased then ArbiterResolved.
/// On refund: emits EscrowRefunded then ArbiterResolved.
public fun arbiter_resolve<T: key + store>(
    escrow: &mut Escrow<T>,
    release: bool,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == escrow.arbiter, ENotAuthorized);
    assert!(escrow.state == STATE_DISPUTED, EInvalidState);

    let item = escrow.item.extract();

    if (release) {
        escrow.state = STATE_RELEASED;
        transfer::public_transfer(item, escrow.recipient);
        event::emit(EscrowReleased {
            escrow_id: escrow.id.to_inner(),
            recipient: escrow.recipient,
        });
    } else {
        escrow.state = STATE_REFUNDED;
        transfer::public_transfer(item, escrow.creator);
        event::emit(EscrowRefunded {
            escrow_id: escrow.id.to_inner(),
            creator: escrow.creator,
        });
    };

    event::emit(ArbiterResolved {
        escrow_id: escrow.id.to_inner(),
        arbiter: sender,
        released: release,
    });
}

/// After timeout, creator can reclaim their asset.
/// Active state: requires clock >= created_at + timeout_ms.
/// Disputed state: requires clock >= disputed_at + DISPUTE_TIMEOUT_MS (arbiter-unreachable fallback).
public fun timelock_refund<T: key + store>(
    escrow: &mut Escrow<T>,
    clock: &Clock,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == escrow.creator, ENotAuthorized);

    if (escrow.state == STATE_ACTIVE) {
        assert!(!escrow.creator_confirmed, EAlreadyConfirmed);
        assert!(
            clock.timestamp_ms() >= escrow.created_at + escrow.timeout_ms,
            ETimeoutNotReached,
        );
    } else if (escrow.state == STATE_DISPUTED) {
        assert!(
            clock.timestamp_ms() >= escrow.disputed_at + DISPUTE_TIMEOUT_MS,
            ETimeoutNotReached,
        );
    } else {
        abort EInvalidState
    };

    escrow.state = STATE_REFUNDED;
    let item = escrow.item.extract();
    transfer::public_transfer(item, escrow.creator);

    event::emit(EscrowRefunded {
        escrow_id: escrow.id.to_inner(),
        creator: escrow.creator,
    });
}

/// Recipient voluntarily declines the deal, returning the asset to the creator.
/// Emits EscrowRejected then EscrowRefunded.
public fun reject<T: key + store>(
    escrow: &mut Escrow<T>,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == escrow.recipient, ENotAuthorized);
    assert!(escrow.state == STATE_ACTIVE, EInvalidState);

    escrow.state = STATE_REFUNDED;
    let item = escrow.item.extract();
    transfer::public_transfer(item, escrow.creator);

    let escrow_id = escrow.id.to_inner();
    event::emit(EscrowRejected { escrow_id, recipient: sender });
    event::emit(EscrowRefunded { escrow_id, creator: escrow.creator });
}

/// Destroy a terminal-state Escrow, recovering on-chain storage.
/// Callable by anyone; state must be Released or Refunded (item already extracted).
public fun destroy<T: key + store>(escrow: Escrow<T>) {
    assert!(
        escrow.state == STATE_RELEASED || escrow.state == STATE_REFUNDED,
        EInvalidState,
    );
    let Escrow { id, item, .. } = escrow;
    item.destroy_none();
    id.delete();
}

// === View Functions ===

public fun escrow_id<T: key + store>(escrow: &Escrow<T>): ID {
    escrow.id.to_inner()
}

public fun creator<T: key + store>(escrow: &Escrow<T>): address {
    escrow.creator
}

public fun recipient<T: key + store>(escrow: &Escrow<T>): address {
    escrow.recipient
}

public fun arbiter<T: key + store>(escrow: &Escrow<T>): address {
    escrow.arbiter
}

public fun description<T: key + store>(escrow: &Escrow<T>): String {
    escrow.description
}

public fun state<T: key + store>(escrow: &Escrow<T>): u8 {
    escrow.state
}

public fun created_at<T: key + store>(escrow: &Escrow<T>): u64 {
    escrow.created_at
}

public fun timeout_ms<T: key + store>(escrow: &Escrow<T>): u64 {
    escrow.timeout_ms
}

public fun creator_confirmed<T: key + store>(escrow: &Escrow<T>): bool {
    escrow.creator_confirmed
}

public fun recipient_confirmed<T: key + store>(escrow: &Escrow<T>): bool {
    escrow.recipient_confirmed
}

public fun disputed_at<T: key + store>(escrow: &Escrow<T>): u64 {
    escrow.disputed_at
}

public fun has_item<T: key + store>(escrow: &Escrow<T>): bool {
    escrow.item.is_some()
}

// === Test Helpers ===

#[test_only]
use sui::test_scenario;
#[test_only]
use std::unit_test;

#[test_only]
const CREATOR: address = @0xA1;
#[test_only]
const RECIPIENT: address = @0xB2;
#[test_only]
const ARBITER: address = @0xC3;
#[test_only]
const UNAUTHORIZED: address = @0xD4;

#[test_only]
public struct TestItem has key, store {
    id: UID,
}

#[test_only]
fun create_test_item(ctx: &mut TxContext): TestItem {
    TestItem { id: object::new(ctx) }
}

/// Convenience: creates an Escrow<TestItem> with default params under the current sender.
#[test_only]
fun create_default_escrow(clock: &Clock, ctx: &mut TxContext) {
    let item = create_test_item(ctx);
    create_and_share(
        item,
        RECIPIENT,
        ARBITER,
        b"Test deal".to_string(),
        MIN_TIMEOUT_MS,
        clock,
        ctx,
    );
}

// ============================================================
// ========================= TESTS ============================
// ============================================================

// ----- 1. Happy path -----

#[test]
fun test_happy_path() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Creator confirms
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        assert!(escrow.creator_confirmed == true);
        assert!(escrow.recipient_confirmed == false);
        assert!(escrow.state == STATE_ACTIVE);
        test_scenario::return_shared(escrow);
    };

    // Recipient confirms → auto-release
    scenario.next_tx(RECIPIENT);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        assert!(escrow.creator_confirmed == true);
        assert!(escrow.recipient_confirmed == true);
        assert!(escrow.state == STATE_RELEASED);
        test_scenario::return_shared(escrow);
    };

    // Recipient received the item
    scenario.next_tx(RECIPIENT);
    {
        let item = scenario.take_from_sender<TestItem>();
        unit_test::destroy(item);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 2. Dispute path (arbiter releases to recipient) -----

#[test]
fun test_dispute_path_release() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Creator disputes
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        assert!(escrow.state == STATE_DISPUTED);
        test_scenario::return_shared(escrow);
    };

    // Arbiter resolves: release to recipient
    scenario.next_tx(ARBITER);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        arbiter_resolve(&mut escrow, true, scenario.ctx());
        assert!(escrow.state == STATE_RELEASED);
        test_scenario::return_shared(escrow);
    };

    // Recipient received the item
    scenario.next_tx(RECIPIENT);
    {
        let item = scenario.take_from_sender<TestItem>();
        unit_test::destroy(item);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 3. Dispute refund path (arbiter refunds to creator) -----

#[test]
fun test_dispute_path_refund() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Recipient disputes
    scenario.next_tx(RECIPIENT);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        assert!(escrow.state == STATE_DISPUTED);
        test_scenario::return_shared(escrow);
    };

    // Arbiter resolves: refund to creator
    scenario.next_tx(ARBITER);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        arbiter_resolve(&mut escrow, false, scenario.ctx());
        assert!(escrow.state == STATE_REFUNDED);
        test_scenario::return_shared(escrow);
    };

    // Creator received the item back
    scenario.next_tx(CREATOR);
    {
        let item = scenario.take_from_sender<TestItem>();
        unit_test::destroy(item);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 4. Timelock path -----

#[test]
fun test_timelock_path() {
    let mut scenario = test_scenario::begin(CREATOR);
    let mut clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Advance clock past timeout
    clock.increment_for_testing(MIN_TIMEOUT_MS);

    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        timelock_refund(&mut escrow, &clock, scenario.ctx());
        assert!(escrow.state == STATE_REFUNDED);
        test_scenario::return_shared(escrow);
    };

    // Creator received the item back
    scenario.next_tx(CREATOR);
    {
        let item = scenario.take_from_sender<TestItem>();
        unit_test::destroy(item);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 5. Confirm-dispute race eliminated -----
// After both confirm and auto-release, state is Released; dispute is impossible.

#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_confirm_dispute_race_eliminated() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Creator confirms
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Recipient confirms → auto-release
    scenario.next_tx(RECIPIENT);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Attempt dispute on Released escrow → must abort EInvalidState
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 6. Dispute timeout fallback -----
// dispute → advance past DISPUTE_TIMEOUT_MS → timelock_refund succeeds

#[test]
fun test_dispute_timeout_fallback() {
    let mut scenario = test_scenario::begin(CREATOR);
    let mut clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Creator disputes
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Advance clock past DISPUTE_TIMEOUT_MS
    clock.increment_for_testing(DISPUTE_TIMEOUT_MS);

    // Creator force-refunds via dispute timeout
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        timelock_refund(&mut escrow, &clock, scenario.ctx());
        assert!(escrow.state == STATE_REFUNDED);
        test_scenario::return_shared(escrow);
    };

    // Creator received the item back
    scenario.next_tx(CREATOR);
    {
        let item = scenario.take_from_sender<TestItem>();
        unit_test::destroy(item);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 7. Disputed blocks normal timelock -----
// dispute → advance past timeout_ms but NOT dispute timeout → timelock_refund fails

#[test]
#[expected_failure(abort_code = ETimeoutNotReached)]
fun test_disputed_blocks_normal_timelock() {
    let mut scenario = test_scenario::begin(CREATOR);
    let mut clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Creator disputes
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Advance past normal timeout but NOT past dispute timeout
    clock.increment_for_testing(MIN_TIMEOUT_MS);

    // Creator tries timelock_refund → fails because in Disputed state the deadline
    // is disputed_at + DISPUTE_TIMEOUT_MS, not created_at + timeout_ms
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        timelock_refund(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 8. Confirm-then-dispute blocked -----
// Creator confirms, then tries to dispute → EAlreadyConfirmedCannotDispute

#[test]
#[expected_failure(abort_code = EAlreadyConfirmedCannotDispute)]
fun test_confirm_then_dispute_blocked() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Creator confirms
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Creator tries to dispute after confirming → blocked
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 9a. Error: unauthorized confirm -----

#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_error_unauthorized_confirm() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    scenario.next_tx(UNAUTHORIZED);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 9b. Error: wrong state for confirm -----

#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_error_wrong_state_confirm() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Dispute first → state becomes Disputed
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Try confirm in Disputed state
    scenario.next_tx(RECIPIENT);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 9c. Error: timeout not reached -----

#[test]
#[expected_failure(abort_code = ETimeoutNotReached)]
fun test_error_timeout_not_reached() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Try refund immediately (clock has not advanced)
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        timelock_refund(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 9d. Error: already confirmed -----

#[test]
#[expected_failure(abort_code = EAlreadyConfirmed)]
fun test_error_already_confirmed() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Creator confirms
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Creator tries to confirm again
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 10a. Arbiter validation: arbiter == creator -----

#[test]
#[expected_failure(abort_code = EInvalidArbiter)]
fun test_arbiter_equals_creator() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let item = create_test_item(scenario.ctx());
    create_and_share(
        item,
        RECIPIENT,
        CREATOR, // arbiter == creator
        b"test".to_string(),
        MIN_TIMEOUT_MS,
        &clock,
        scenario.ctx(),
    );

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 10b. Arbiter validation: arbiter == recipient -----

#[test]
#[expected_failure(abort_code = EInvalidArbiter)]
fun test_arbiter_equals_recipient() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let item = create_test_item(scenario.ctx());
    create_and_share(
        item,
        RECIPIENT,
        RECIPIENT, // arbiter == recipient
        b"test".to_string(),
        MIN_TIMEOUT_MS,
        &clock,
        scenario.ctx(),
    );

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 11. Creator-recipient validation -----

#[test]
#[expected_failure(abort_code = ECreatorIsRecipient)]
fun test_creator_equals_recipient() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let item = create_test_item(scenario.ctx());
    create_and_share(
        item,
        CREATOR, // recipient == creator
        ARBITER,
        b"test".to_string(),
        MIN_TIMEOUT_MS,
        &clock,
        scenario.ctx(),
    );

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 12. Creator self-dispute -----

#[test]
fun test_creator_self_dispute() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Creator disputes own escrow (hasn't confirmed, so this is allowed)
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        assert!(escrow.state == STATE_DISPUTED);
        assert!(escrow.disputed_at == clock.timestamp_ms());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 13. Arbiter resolve in Active state -----

#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_arbiter_resolve_in_active() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Arbiter tries to resolve an Active (non-disputed) escrow
    scenario.next_tx(ARBITER);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        arbiter_resolve(&mut escrow, true, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 14a. Destroy: Released state -----

#[test]
fun test_destroy_released() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Both confirm → Released
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };
    scenario.next_tx(RECIPIENT);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Destroy the Released escrow
    scenario.next_tx(CREATOR);
    {
        let escrow = scenario.take_shared<Escrow<TestItem>>();
        destroy(escrow);
    };

    // Clean up transferred item
    scenario.next_tx(RECIPIENT);
    {
        let item = scenario.take_from_sender<TestItem>();
        unit_test::destroy(item);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 14b. Destroy: Refunded state -----

#[test]
fun test_destroy_refunded() {
    let mut scenario = test_scenario::begin(CREATOR);
    let mut clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Advance clock past timeout and refund
    clock.increment_for_testing(MIN_TIMEOUT_MS);
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        timelock_refund(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Destroy the Refunded escrow
    scenario.next_tx(CREATOR);
    {
        let escrow = scenario.take_shared<Escrow<TestItem>>();
        destroy(escrow);
    };

    // Clean up refunded item
    scenario.next_tx(CREATOR);
    {
        let item = scenario.take_from_sender<TestItem>();
        unit_test::destroy(item);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 14c. Destroy: Active state fails -----

#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_destroy_active_fails() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    scenario.next_tx(CREATOR);
    {
        let escrow = scenario.take_shared<Escrow<TestItem>>();
        destroy(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 14d. Destroy: Disputed state fails -----

#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_destroy_disputed_fails() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Dispute first
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Try to destroy Disputed escrow
    scenario.next_tx(CREATOR);
    {
        let escrow = scenario.take_shared<Escrow<TestItem>>();
        destroy(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 15a. Error: unauthorized dispute -----

#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_error_unauthorized_dispute() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    scenario.next_tx(UNAUTHORIZED);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 15b. Error: non-arbiter calls arbiter_resolve -----

#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_error_non_arbiter_resolve() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Dispute first to reach Disputed state
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Non-arbiter tries to resolve
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        arbiter_resolve(&mut escrow, true, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 15c. Error: recipient calls timelock_refund -----

#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_error_recipient_timelock_refund() {
    let mut scenario = test_scenario::begin(CREATOR);
    let mut clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    clock.increment_for_testing(MIN_TIMEOUT_MS);

    scenario.next_tx(RECIPIENT);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        timelock_refund(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 15d. Error: timeout_ms too short -----

#[test]
#[expected_failure(abort_code = ETimeoutTooShort)]
fun test_error_timeout_too_short() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let item = create_test_item(scenario.ctx());
    create_and_share(
        item,
        RECIPIENT,
        ARBITER,
        b"test".to_string(),
        MIN_TIMEOUT_MS - 1,
        &clock,
        scenario.ctx(),
    );

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 15e. Error: timeout_ms too long -----

#[test]
#[expected_failure(abort_code = ETimeoutTooLong)]
fun test_error_timeout_too_long() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let item = create_test_item(scenario.ctx());
    create_and_share(
        item,
        RECIPIENT,
        ARBITER,
        b"test".to_string(),
        MAX_TIMEOUT_MS + 1,
        &clock,
        scenario.ctx(),
    );

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 15f. Error: description too long -----

#[test]
#[expected_failure(abort_code = EDescriptionTooLong)]
fun test_error_description_too_long() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let item = create_test_item(scenario.ctx());

    // 1025 bytes exceeds MAX_DESCRIPTION_BYTES (1024)
    let mut desc_bytes = vector[];
    let mut i: u64 = 0;
    while (i <= MAX_DESCRIPTION_BYTES) {
        desc_bytes.push_back(65u8);
        i = i + 1;
    };

    create_and_share(
        item,
        RECIPIENT,
        ARBITER,
        desc_bytes.to_string(),
        MIN_TIMEOUT_MS,
        &clock,
        scenario.ctx(),
    );

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 16. Error: timelock_refund after creator confirmed -----

#[test]
#[expected_failure(abort_code = EAlreadyConfirmed)]
fun test_error_timelock_after_confirm() {
    let mut scenario = test_scenario::begin(CREATOR);
    let mut clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Creator confirms
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        confirm(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Advance clock past timeout
    clock.increment_for_testing(MIN_TIMEOUT_MS);

    // Creator tries timelock_refund after confirming → blocked
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        timelock_refund(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 17a. Reject: happy path -----

#[test]
fun test_reject_happy_path() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Recipient rejects the deal
    scenario.next_tx(RECIPIENT);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        reject(&mut escrow, scenario.ctx());
        assert!(escrow.state == STATE_REFUNDED);
        test_scenario::return_shared(escrow);
    };

    // Creator received the item back
    scenario.next_tx(CREATOR);
    {
        let item = scenario.take_from_sender<TestItem>();
        unit_test::destroy(item);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 17b. Error: unauthorized reject -----

#[test]
#[expected_failure(abort_code = ENotAuthorized)]
fun test_error_unauthorized_reject() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Creator (not recipient) tries to reject
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        reject(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}

// ----- 17c. Error: reject in wrong state -----

#[test]
#[expected_failure(abort_code = EInvalidState)]
fun test_error_reject_wrong_state() {
    let mut scenario = test_scenario::begin(CREATOR);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    create_default_escrow(&clock, scenario.ctx());

    // Dispute first → state becomes Disputed
    scenario.next_tx(CREATOR);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        dispute(&mut escrow, &clock, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    // Recipient tries to reject in Disputed state
    scenario.next_tx(RECIPIENT);
    {
        let mut escrow = scenario.take_shared<Escrow<TestItem>>();
        reject(&mut escrow, scenario.ctx());
        test_scenario::return_shared(escrow);
    };

    clock.destroy_for_testing();
    scenario.end();
}
