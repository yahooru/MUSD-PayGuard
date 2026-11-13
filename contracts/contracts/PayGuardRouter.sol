// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title PayGuardRouter
/// @notice Non-custodial MUSD invoice-payment router with on-chain duplicate protection.
///         A payer sends `amount` of the configured token directly to `to`, tagged with an
///         `invoiceRef`. The router records the payment so that ANY wallet, device or merchant
///         system can later verify on-chain that the invoice was paid, and so that the same
///         payer cannot accidentally pay the same invoice to the same recipient twice.
///
/// @dev Threat model and design decisions
///  - NON-CUSTODIAL: funds move payer -> recipient in a single `transferFrom`. The router never
///    holds a token balance, has no owner, no admin, no fee, no pause and no upgrade path.
///    It accepts no native currency (no receive/fallback; functions are non-payable).
///  - PER-PAYER DUPLICATE KEY: the duplicate key is keccak256(abi.encode(payer, recipient, ref)).
///    Keying only on (recipient, ref) would let a stranger grief a payer by front-running a dust
///    payment carrying the victim's invoice ref, permanently blocking the real payment. With
///    per-payer keys a payer can only ever block themselves (which is the point: protection
///    against paying the same invoice twice from any device).
///  - MERCHANT AGGREGATE: `totalPaidTo[recipient][ref]` / `paymentCountTo[recipient][ref]` sum
///    every payment for a ref regardless of payer. They are informational and griefing-resistant:
///    a dust payment only adds dust, so a merchant should check `totalPaidTo >= invoiceAmount`
///    (and inspect `InvoicePaid` events for who paid) rather than a boolean.
///  - APPROVALS: callers should approve EXACTLY `amount` (never unlimited) or use
///    `payWithPermit`, which grants a single exact-amount EIP-2612 allowance that is consumed in
///    the same transaction, leaving no standing allowance behind.
///  - PERMIT FRONT-RUNNING: the permit call is wrapped in try/catch. If someone front-runs the
///    permit signature (submitting it themselves), the allowance already exists and the payment
///    still succeeds; if the permit is invalid and no allowance exists, `transferFrom` reverts.
///  - CHECKS-EFFECTS-INTERACTIONS: state is written before the external token call. The token is
///    immutable and set at construction (MUSD on Mezo testnet:
///    0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503).
///  - INVOICE REF ENCODING (off-chain convention used by MUSD PayGuard):
///    invoiceRef = keccak256(utf8(normalizedRef)) where
///    normalizedRef = NFKC(ref).trim(), internal whitespace runs collapsed to a single space,
///    then upper-cased. E.g. "  inv-0042 " and "INV-0042" map to the same bytes32.
///    The router itself treats invoiceRef as an opaque non-zero bytes32.
contract PayGuardRouter {
    using SafeERC20 for IERC20;

    /// @notice Recorded payment for a (payer, recipient, invoiceRef) triple.
    struct Payment {
        uint256 amount;
        uint64 paidAt;
        uint64 blockNumber;
    }

    /// @notice The only token this router moves (MUSD). Immutable.
    IERC20 public immutable token;

    /// @notice Payments keyed by `paymentKey(payer, recipient, invoiceRef)`.
    mapping(bytes32 => Payment) public payments;

    /// @notice Sum of all amounts paid to `recipient` for `invoiceRef`, by any payer.
    mapping(address => mapping(bytes32 => uint256)) public totalPaidTo;

    /// @notice Number of payments made to `recipient` for `invoiceRef`, by any payer.
    mapping(address => mapping(bytes32 => uint256)) public paymentCountTo;

    /// @notice Emitted for every successful payment.
    /// @param payer The account whose tokens were transferred (msg.sender).
    /// @param recipient The account that received the tokens.
    /// @param invoiceRef keccak256 of the normalized invoice reference.
    /// @param amount Amount transferred, in token base units.
    /// @param totalPaidForRef `totalPaidTo[recipient][invoiceRef]` after this payment.
    event InvoicePaid(
        address indexed payer,
        address indexed recipient,
        bytes32 indexed invoiceRef,
        uint256 amount,
        uint256 totalPaidForRef
    );

    error ZeroToken();
    error ZeroAmount();
    error EmptyInvoiceRef();
    error InvalidRecipient(address recipient);
    error AlreadyPaid(address payer, address recipient, bytes32 invoiceRef);

    /// @param token_ Address of the token to route (MUSD). Must be non-zero.
    constructor(address token_) {
        if (token_ == address(0)) revert ZeroToken();
        token = IERC20(token_);
    }

    /// @notice Pay `amount` tokens to `to` for `invoiceRef`. Requires a prior allowance of at
    ///         least `amount` to this router (approve exactly `amount`).
    function pay(address to, uint256 amount, bytes32 invoiceRef) external {
        _pay(to, amount, invoiceRef);
    }

    /// @notice Same as `pay`, but first applies an EIP-2612 permit for exactly `amount`, so no
    ///         separate approve transaction (and no standing allowance) is needed.
    /// @dev The permit is wrapped in try/catch so a front-run permit does not break the payment.
    function payWithPermit(
        address to,
        uint256 amount,
        bytes32 invoiceRef,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        try IERC20Permit(address(token)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _pay(to, amount, invoiceRef);
    }

    /// @notice Whether `payer` has paid `recipient` for `invoiceRef` through this router.
    function isPaid(address payer, address recipient, bytes32 invoiceRef) external view returns (bool) {
        return payments[paymentKey(payer, recipient, invoiceRef)].paidAt != 0;
    }

    /// @notice Full payment record for a (payer, recipient, invoiceRef) triple.
    function getPayment(address payer, address recipient, bytes32 invoiceRef)
        external
        view
        returns (bool paid, uint256 amount, uint256 paidAt, uint256 blockNumber)
    {
        Payment storage p = payments[paymentKey(payer, recipient, invoiceRef)];
        return (p.paidAt != 0, p.amount, p.paidAt, p.blockNumber);
    }

    /// @notice Storage key for a (payer, recipient, invoiceRef) triple.
    function paymentKey(address payer, address recipient, bytes32 invoiceRef) public pure returns (bytes32) {
        return keccak256(abi.encode(payer, recipient, invoiceRef));
    }

    function _pay(address to, uint256 amount, bytes32 invoiceRef) private {
        // Checks
        if (amount == 0) revert ZeroAmount();
        if (invoiceRef == bytes32(0)) revert EmptyInvoiceRef();
        if (to == address(0) || to == address(this) || to == address(token) || to == msg.sender) {
            revert InvalidRecipient(to);
        }
        bytes32 key = paymentKey(msg.sender, to, invoiceRef);
        if (payments[key].paidAt != 0) revert AlreadyPaid(msg.sender, to, invoiceRef);

        // Effects
        payments[key] = Payment({amount: amount, paidAt: uint64(block.timestamp), blockNumber: uint64(block.number)});
        uint256 total = totalPaidTo[to][invoiceRef] + amount;
        totalPaidTo[to][invoiceRef] = total;
        unchecked {
            paymentCountTo[to][invoiceRef] += 1;
        }

        // Interaction: tokens go straight from payer to recipient.
        token.safeTransferFrom(msg.sender, to, amount);

        emit InvoicePaid(msg.sender, to, invoiceRef, amount, total);
    }
}
