# MUSD PayGuard — Complete Project Specification

## 1. Project Overview

Build a complete, secure, modern Web3 application called **MUSD PayGuard**, a transaction safety and payment verification platform built around MUSD on the Mezo network.

### Tagline
**“Check Before You Send.”**

MUSD PayGuard helps users make safer stablecoin payments by checking transaction details before they approve a transfer, identifying common payment mistakes, warning about suspicious recipient information, detecting duplicate payment requests, and providing clear transaction verification after payment.

The project is designed for people who use stablecoins but may not fully understand blockchain transactions, wallet addresses, token approvals, network selection, or the risks of sending funds to the wrong recipient.

The primary objective is to build a working product that improves the safety and usability of MUSD payments while extending MUSD's utility within the Mezo ecosystem.

This must be a functional application, not just a dashboard or a static prototype.

## 2. The Problem

Blockchain payments can be difficult to reverse. Users may lose funds because they:

- Enter an incorrect recipient address.
- Send tokens on the wrong network.
- Pay the same invoice twice.
- Fall for a misleading payment request.
- Interact with an unverified token contract.
- Approve an unnecessary or excessive token allowance.
- Misunderstand transaction fees.
- Assume a transaction succeeded before it is confirmed.
- Trust a fake transaction screenshot or a payment confirmation supplied by someone else.

Most beginners do not have an easy way to review these risks in one place before sending a payment.

## 3. The Solution

MUSD PayGuard acts as a safety layer between the user and their wallet.

Before a user sends MUSD, PayGuard collects the transaction details and performs a series of checks.

It validates the recipient address format, verifies the selected network and configured MUSD token contract, checks the available balance, detects duplicate payment references where possible, identifies unusual transaction details, and explains any detected risks.

The application then presents a clear transaction review screen.

The user remains in control of the transaction and must explicitly approve it through their connected wallet.

After the transaction is submitted, PayGuard tracks its status and verifies the transaction receipt and relevant token transfer details before displaying a confirmed payment.

PayGuard must never claim that it can guarantee a recipient is trustworthy or prevent every scam. Its purpose is to reduce common mistakes and provide meaningful, evidence-based warnings.

## 4. Target Users

Build for:

- People new to cryptocurrency.
- Users making MUSD payments.
- Freelancers paying or receiving invoices.
- Online merchants accepting stablecoins.
- Web3 applications that need safer payment flows.
- Small businesses managing multiple blockchain payments.
- Developers who want to integrate transaction checks into their applications.

## 5. Core Feature: Smart Transaction Preflight

This is the main feature of MUSD PayGuard.

Every payment should go through a preflight review before the user approves it.

### Required checks

**A. Recipient address validation**
- Check that the recipient is a syntactically valid address for the selected EVM network.
- Reject malformed addresses.
- Display the complete address in the final confirmation screen.
- Provide a copy-address function.
- Warn users when an address differs from a previously saved recipient.
- Never claim that a valid address format proves ownership or trustworthiness.

**B. Network verification**
- Check the connected wallet's chain ID.
- Ensure the transaction uses the configured supported network.
- Prompt the user to switch networks when necessary.
- Do not construct or send a payment using an unexpected chain.

**C. Token verification**
- Use a token contract address obtained from verified official network configuration.
- Verify the token contract and its expected properties.
- Display the token name, symbol, amount, and network.
- Do not trust a token merely because its name or symbol is MUSD.
- Fail safely if the configured token cannot be verified.

**D. Balance and fee checks**
- Read the user's actual MUSD balance.
- Check whether the balance covers the intended payment.
- Check the wallet's native gas-token balance where possible.
- Explain that the token balance and network gas balance are separate.
- Show fee estimates when reliable estimates are available.
- Warn when a payment cannot reasonably be completed.

**E. Transaction simulation**
- Simulate the proposed transaction when supported by the RPC provider or wallet infrastructure.
- Detect simulation failures and explain the reason when known.
- Do not assume a successful simulation guarantees a successful transaction.
- Clearly state when simulation is unavailable.

**F. Final transaction review**
Display:
- Recipient address.
- Token and amount.
- Network.
- Estimated gas fee.
- Transaction purpose or invoice reference.
- Warnings and their reasons.
- A clear confirmation button.

The user must explicitly confirm before the application requests a wallet signature.

## 6. Duplicate Payment Protection

Build a feature that helps users avoid accidentally paying the same invoice twice.

Allow users to create or enter a payment reference associated with an invoice or payment request.

For each payment, store:
- Recipient address.
- Token contract.
- Network.
- Amount.
- Invoice or request reference.
- Transaction hash, once available.
- Timestamp.
- Payment status.

Before sending, compare the proposed payment with previously recorded payments and pending transactions.

Warn the user if the same invoice reference has already been paid or if a highly similar payment is pending or recently completed.

Provide an explanation such as:

"Possible duplicate payment: this invoice reference has already been associated with a confirmed transaction."

Users should be able to inspect the earlier payment before deciding how to proceed.

Do not automatically block all payments to the same recipient for the same amount. Legitimate recurring payments may be identical.

Duplicate detection should use available evidence and explain the limitations of each match.

## 7. Trusted Recipient Book

Allow users to save frequently used recipient addresses.

Each recipient record should contain:
- Contact name.
- Wallet address.
- Network.
- Optional business or invoice notes.
- Date added.
- Optional verification status.

Features:
- Add a recipient.
- Edit a contact label.
- Remove a saved recipient.
- Search saved recipients.
- Copy an address.
- Select a recipient during payment.
- Warn when a newly entered address differs from the saved address.

Do not describe a recipient as officially verified unless an actual verification mechanism exists.

A saved address only means the user saved it. It does not establish that the address belongs to the intended person.

For important transfers, encourage users to independently verify the full address through a trusted communication channel.

## 8. Payment Request Verification

Allow users to create and review payment requests.

A request should contain:
- Request creator.
- Recipient wallet.
- Requested amount.
- Token contract.
- Network.
- Invoice reference.
- Description.
- Creation date.
- Expiry date, if applicable.
- Payment status.

When opening a request, PayGuard should validate its fields and check whether the request has already been associated with a confirmed payment.

Warn about:
- Malformed recipient addresses.
- Unsupported networks.
- Unverified token contracts.
- Expired requests.
- Previously paid invoice references.
- Inconsistent payment details.
- Requests that conflict with previously recorded information.

A valid request does not prove that the person requesting payment is legitimate.

Do not present AI-generated risk scores as authoritative proof of fraud.

## 9. Risk Assessment Engine

Create a transparent rules-based risk engine.

For every payment, return a structured assessment containing:
- Overall risk category.
- Individual checks performed.
- Findings.
- Reasons for each warning.
- Recommended next action.
- Checks that could not be completed.

Use three primary categories:

**Low observed risk**
No configured checks found a specific problem. This does not mean the payment is guaranteed safe.

**Caution**
One or more checks identified an unusual condition that deserves review.

**High risk**
A critical validation failed, or a serious inconsistency was detected. Block the normal send flow for objective failures such as an invalid address or unsupported network. For suspicious but inconclusive findings, show a strong warning and require an additional confirmation where appropriate.

Examples of risk signals:
- Recipient differs from a previously saved address.
- Invoice reference appears to have been paid already.
- Transaction simulation failed.
- Network does not match the configured network.
- Token contract does not match the trusted configuration.
- Payment amount differs from the associated invoice.
- The recipient address is malformed.
- Transaction details changed after the initial review.

Every risk result must be explainable. Do not generate arbitrary scores without documented rules and evidence.

The application must distinguish between:
1. A confirmed technical failure.
2. A warning based on a suspicious pattern.
3. A check that could not be performed.

## 10. Transaction Confirmation and Verification

After the user approves a transaction through their wallet:

1. Record the submitted transaction hash.
2. Mark the transaction as pending.
3. Monitor the transaction receipt.
4. Verify that it was included in the expected network.
5. Confirm successful execution.
6. Inspect the expected MUSD token transfer event.
7. Verify the sender, recipient, token contract, and transferred amount.
8. Mark the payment as confirmed only when all required checks pass.
9. Display the transaction hash and official explorer link.

If the transaction fails, display a failed status.

If the RPC provider is unavailable or confirmation cannot be established, show a pending or verification-delayed state rather than claiming success.

Do not trust a transaction hash alone. Verify the underlying receipt and transfer details.

The UI should support:
- Pending.
- Confirmed.
- Failed.
- Verification delayed.
- Unknown or unavailable status.

Prevent duplicate submissions and handle page refreshes without losing the transaction's tracking state.

## 11. Transaction History

Create a transaction history page containing:
- Date and time.
- Recipient.
- Token amount.
- Network.
- Invoice reference.
- Risk assessment summary.
- Transaction status.
- Transaction hash.
- Explorer link.

Include search and filters for:
- Confirmed payments.
- Pending payments.
- Failed payments.
- Recipient.
- Date range.
- Amount range.
- Risk category.

Users should be able to open an individual transaction to inspect the checks performed before payment and the verification results afterward.

Clearly distinguish actual on-chain transactions from saved payment requests or unsigned transaction drafts.

## 12. Payment Receipt

After a confirmed transaction, generate a clean payment receipt containing:
- Payment amount.
- Token symbol.
- Sender address.
- Recipient address.
- Network.
- Transaction hash.
- Block number, if available.
- Confirmation status.
- Invoice reference.
- Verification timestamp.

Include buttons to copy the transaction hash and open the relevant block explorer.

Optionally allow exporting a receipt as a printable page or PDF.

Do not describe an off-chain receipt as a cryptographic proof unless it contains independently verifiable evidence.

## 13. Wallet Integration

Implement wallet connectivity using an appropriate EVM wallet integration library.

Requirements:
- Connect wallet.
- Disconnect wallet.
- Display the shortened wallet address.
- Display the selected network.
- Detect account changes.
- Detect network changes.
- Read the actual MUSD balance.
- Request transaction signatures only after user confirmation.
- Handle rejected signatures.
- Handle insufficient balance.
- Handle RPC failures.
- Prevent unsupported-network transactions.

Use TypeScript with wagmi and viem, or another compatible and maintained EVM integration.

Never request, transmit, or store wallet seed phrases or private keys.

Do not create a custodial wallet. Users must retain control of their own wallets and transaction approvals.

## 14. Optional AI Security Assistant

Add an optional assistant that explains payment risks in plain language.

Examples:
- "This address differs from the one you saved for this recipient."
- "This invoice reference appears in an earlier confirmed payment."
- "Your wallet is connected to a network that this application does not support."
- "The transaction could not be simulated. Review the details before proceeding."

The assistant should explain findings produced by the actual validation engine.

It must not invent threat intelligence, claim an address is malicious without evidence, or override critical validation failures.

If an external AI service is unavailable, the rules-based explanations must continue working.

For the MVP, prioritise deterministic safety checks over AI.

## 15. Merchant and Developer Integration

Design PayGuard so it can eventually be integrated into merchant checkout flows.

Potential future capabilities:
- Generate payment requests.
- Verify incoming MUSD payments.
- Detect duplicate invoice payments.
- Provide transaction-status webhooks.
- Offer a reusable payment review component.
- Provide a documented API for transaction validation.
- Provide an SDK for developers.

For the MVP, build one functional payment request flow and one complete payment verification flow before adding a public API or SDK.

Never expose secret API keys in client-side code.

## 16. UI and Design Requirements

Build a polished, premium fintech security interface.

Design direction:
- Dark navy or charcoal background.
- Violet, cyan, or blue accents.
- Clear typography.
- Restrained gradients.
- Rounded cards.
- Consistent spacing.
- Subtle borders and shadows.
- Professional icons.
- Clear status indicators.
- Responsive layouts.

The application should look like a credible security product, not a generic admin dashboard.

Use accessible colours and never communicate risk through colour alone. Every warning must include readable text and an explanation.

Provide proper:
- Loading states.
- Empty states.
- Success states.
- Error states.
- Pending states.
- Confirmation dialogs.
- Wallet connection states.
- Mobile layouts.

Avoid unnecessary animations that make transaction status harder to understand.

## 17. Required Pages

Implement the following pages:

### 1. Landing Page
- Explain the payment safety problem.
- Explain how PayGuard works.
- Show core security features.
- Include a Connect Wallet button.
- Include a clear testnet disclosure.

### 2. Dashboard
- Connected wallet.
- MUSD balance.
- Recent payments.
- Pending transactions.
- Recent risk warnings.
- Saved recipients.
- Quick action to make a payment.

### 3. Send MUSD Page
- Recipient input.
- Saved recipient selection.
- Amount input.
- Payment reference.
- Network and token information.
- Validation results.
- Transaction review.

### 4. Security Review Page
- Individual validation results.
- Risk category.
- Explanation of warnings.
- Simulation result, if supported.
- Final transaction details.
- Confirmation or blocking state.

### 5. Payment Requests Page
- Create a payment request.
- Review incoming requests.
- View sent requests.
- Detect duplicate references.
- View request status.

### 6. Trusted Recipients Page
- Add recipient.
- Edit contact labels.
- Remove recipient.
- Compare recipient addresses.
- Search and filter.

### 7. Transaction History Page
- Transaction list.
- Status filters.
- Risk filters.
- Search.
- Explorer links.

### 8. Transaction Details Page
- Transaction receipt.
- Verified transfer details.
- Checks performed.
- Risk warnings.
- Transaction hash.
- Block explorer link.

### 9. Security Centre
- Summary of configured safety checks.
- Recent warnings.
- Failed validations.
- Verification status.
- Explanations of the product's limitations.

### 10. Settings Page
- Wallet information.
- Supported network information.
- Security preferences.
- Notification preferences.
- Privacy information.

### 11. Help and About
- How PayGuard works.
- Common wallet errors.
- Understanding transaction status.
- Security limitations.
- Frequently asked questions.

## 18. Recommended Technical Architecture

### Frontend
- React or Next.js.
- TypeScript.
- Tailwind CSS.
- Accessible reusable UI components.
- wagmi and viem for wallet connectivity and EVM interactions.

### Blockchain
- Mezo testnet for initial deployment.
- Verified MUSD token configuration.
- Standard token transfer functionality.
- RPC access for balance reads, transaction simulation where available, and receipt verification.
- Correct block explorer links.

### Backend
Use a suitable backend with persistent storage where required.

Possible technologies:
- Next.js server routes or a separate Node.js API.
- PostgreSQL.
- Prisma or another suitable ORM.
- Secure authentication tied to wallet ownership, such as signed-message authentication.

The backend should manage saved recipients, payment requests, invoice references, transaction tracking, and user preferences.

### Suggested data models
- User.
- Wallet.
- TrustedRecipient.
- PaymentRequest.
- PaymentDraft.
- TransactionRecord.
- RiskAssessment.
- ValidationCheck.
- Notification.
- AuditEvent.

A payment draft is not a transaction. A transaction submitted to the network is not necessarily confirmed. Preserve these distinctions throughout the data model.

## 19. Blockchain Configuration

Use official Mezo documentation to configure the correct network and token contract.

Mezo's developer documentation:
https://mezo.org/docs/developers/

Official contract reference:
https://mezo.org/docs/users/resources/contracts-reference

The official Mezo documentation currently lists the following MUSD contract addresses:
- Mezo testnet MUSD: 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
- Mezo mainnet MUSD: 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186

Treat these as reference values that must be rechecked against official documentation and the target network before deployment.

Configure:
- Chain ID.
- RPC endpoint.
- MUSD contract address.
- Expected token decimals.
- Block explorer base URL.
- Confirmation and receipt polling behaviour.

Do not scatter network details throughout the codebase. Use a central, validated network configuration module.

Never assume that testnet and mainnet contracts are interchangeable.

Do not silently fall back to a different token contract or network if verification fails.

## 20. Smart Contract Strategy

For the initial MVP, avoid deploying a custom contract unless it provides a specific, necessary security benefit.

Use the verified MUSD token contract for direct user-authorised transfers and build the safety checks around that transfer flow.

PayGuard does not need custody of user funds.

A custom contract may be considered later for specific functions such as controlled merchant settlement, but only after defining the threat model, permissions, failure cases, and contract security requirements.

Do not claim that the application can reverse a normal blockchain transfer.

Do not claim that the application can block every malicious transaction once the user approves an external wallet transaction.

## 21. Security Requirements

- Never request or store seed phrases or private keys.
- Never automatically sign a transaction without user approval.
- Verify the network and token contract before payment.
- Validate recipient addresses and transaction amounts.
- Protect server-side endpoints against unauthorised access.
- Verify wallet ownership before allowing sensitive actions.
- Prevent duplicate submission bugs.
- Verify transaction receipts before marking payments confirmed.
- Validate all user input.
- Protect against replayed or forged application requests.
- Use secure environment variables for server secrets.
- Keep user data private.
- Avoid storing unnecessary personal information.
- Never trust client-provided transaction status.
- Do not use arbitrary AI outputs as a security decision.
- Clearly disclose limitations and uncertainty.

## 22. Testing Requirements

Create automated tests for the validation engine and transaction lifecycle.

### Unit tests
- Valid and invalid addresses.
- Supported and unsupported networks.
- Correct and incorrect token contracts.
- Insufficient MUSD balance.
- Insufficient gas balance.
- Duplicate invoice references.
- Saved recipient address changes.
- Risk category calculation.
- Validation failure handling.
- Transaction status transitions.

### Integration tests
- Wallet connection.
- Network switching.
- MUSD balance reading.
- Transaction simulation.
- Wallet signature rejection.
- Successful testnet transfer.
- Failed transaction.
- Receipt verification.
- Incorrect recipient or amount in a receipt.
- RPC outage.
- Duplicate payment submission.
- Transaction tracking after page refresh.

### End-to-end demo
1. Alice connects her wallet.
2. PayGuard reads Alice's actual MUSD balance.
3. Alice selects a saved recipient.
4. Alice enters a payment amount and invoice reference.
5. PayGuard validates the recipient, network, token and balance.
6. PayGuard identifies a duplicate invoice reference or another testable warning.
7. Alice reviews the warning.
8. Alice corrects the payment details.
9. PayGuard validates the corrected transaction.
10. Alice explicitly approves the payment in her wallet.
11. The transaction is submitted to Mezo testnet.
12. PayGuard verifies the transaction receipt and token transfer.
13. Alice sees the confirmed transaction and explorer link.

Also demonstrate a rejected wallet signature and a failed validation so judges can see that error handling actually works.

## 23. MVP Build Priorities

### Phase 1: Functional Foundation
- Landing page.
- Wallet connection.
- Network detection.
- Central token configuration.
- Real MUSD balance.
- Send-payment form.
- Basic address and amount validation.

### Phase 2: Safety Engine
- Token and network checks.
- Duplicate invoice detection.
- Saved recipients.
- Preflight transaction review.
- Explainable risk assessment.
- Simulation where available.

### Phase 3: Real Blockchain Payments
- Wallet-authorised MUSD transfer.
- Pending transaction tracking.
- Receipt verification.
- Confirmed and failed states.
- Transaction history.
- Explorer links.

### Phase 4: Product Polish
- Dashboard.
- Security centre.
- Payment requests.
- Transaction receipts.
- Responsive design.
- Error handling.
- Automated tests.

### Phase 5: Advanced Features
- Merchant integration.
- Developer SDK.
- Optional AI explanations.
- Notifications.
- Additional supported networks after testing.

Do not start advanced features until the complete testnet payment flow works reliably.

## 24. Mezo Buildathon Alignment

MUSD PayGuard should extend the utility of MUSD by making stablecoin payments easier to review, understand, and verify.

The key integration is not simply displaying MUSD prices or connecting a wallet. The application must use real MUSD token information and support a genuine MUSD payment flow, with meaningful safety checks and verified transaction outcomes.

The project should demonstrate:
- Real MUSD integration.
- Working deployment on an eligible network.
- Meaningful transaction verification.
- Composable, maintainable architecture.
- A clear user problem and practical solution.
- A polished and understandable demo.

The official developer resources should be used to confirm the implementation details.

## 25. Final Deliverables

Produce:
- Complete responsive frontend.
- Functional transaction validation engine.
- Wallet integration.
- Real testnet MUSD payment flow.
- Transaction verification system.
- Persistent transaction history.
- Public GitHub repository.
- README with setup instructions.
- Example environment configuration without secrets.
- Automated tests.
- Deployment instructions.
- Architecture and security overview.
- A two-minute demo video.
- A project pitch and roadmap.

## 26. Definition of Done

MUSD PayGuard is ready for its MVP demonstration when a user can connect a wallet, review and validate a proposed MUSD payment, receive meaningful warnings for detectable problems, approve a legitimate payment through their wallet, and see its verified outcome on the Mezo testnet.

The application must also correctly handle rejected transactions, invalid addresses, unsupported networks, duplicate payment references, and delayed transaction confirmation.

No fake balances, fake transaction hashes, fabricated risk findings, or simulated successful transfers may be presented as real blockchain results.

If a required integration is unavailable, clearly identify the blocker and document what remains incomplete.

## 27. Instructions to the AI Coding Agent

First, inspect the existing repository and identify the framework, dependencies, current application structure, and deployment configuration.

Then:
1. Propose a concise implementation plan.
2. Establish a clean, reusable design system.
3. Implement the core frontend and wallet integration.
4. Build the validation engine independently from the UI.
5. Integrate the verified MUSD contract and Mezo testnet.
6. Implement the actual transaction flow and receipt verification.
7. Add persistent transaction history and duplicate detection.
8. Write and run automated tests.
9. Fix errors and verify the application end to end.
10. Document setup, deployment, security limitations, and any remaining blockers.

Make sensible implementation decisions without repeatedly asking for permission for ordinary coding details.

Prioritise functional correctness, transaction safety, clear user feedback, and a polished user experience.

Do not stop after producing a beautiful interface. The main goal is a working MUSD transaction safety product that users can test and judges can verify.