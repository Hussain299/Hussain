# SignalForge ML — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Owner-Isolated Private Data**: `/users/{userId}` (containing PII `email`), `/users/{userId}/tradeLedger/{signalId}`, and `/users/{userId}/settings/{settingId}` are strictly scoped to `request.auth.uid == userId` (or verified admin).
2. **Master Gate**: Every write or read on subcollections (`/tradeLedger/{signalId}`, `/settings/{settingId}`) verifies parent `/users/{userId}` existence via `exists()` on single-doc operations, and validates `resource.data.ownerId == request.auth.uid` on `list` queries without `get()`/`exists()` inside `allow list`.
3. **Terminal Settlement Immutability**: Once a `TradeRecord` reaches `lifecycleState == 'CLOSED'` with `outcomeResult in ['WIN', 'LOSS', 'SCRATCH']`, NO client update can alter its outcome, entry/exit prices, or return units (except verified admin override).
4. **Strict Verified Identity**: Every standard write requires `request.auth != null && request.auth.token.email_verified == true`.
5. **Temporal Integrity**: `createdAt` on create and `updatedAt` on create/update must strictly equal `request.time`; `createdAt` and `ownerId`/`uid` are immortal after creation.
6. **Zero Privilege Escalation**: Users can only create profiles with `role == 'trader'` and cannot modify `role` on update; `/admins/{adminId}` blocks all client writes.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Reading or writing `/users/u1/tradeLedger/sig_1` when `request.auth == null`.
2. **Unverified Email Write**: Creating a trade record when `request.auth.token.email_verified == false`.
3. **Cross-User PII Read**: User `u2` attempting `get` on `/users/u1` (leaking `email`).
4. **Cross-User Ledger List Scrape**: User `u2` attempting `list` on `/users/u1/tradeLedger`.
5. **Identity Spoofing on Create**: User `u1` creating `/users/u1/tradeLedger/sig_1` with `ownerId: "u2"`.
6. **Self-Assigned Admin Role**: User `u1` creating `/users/u1` with `role: "admin"` or updating `role` to `"admin"`.
7. **Shadow / Ghost Field Injection**: Creating or updating a `TradeRecord` with an extra undeclared field `isVerified: true`.
8. **Terminal Settlement Tampering**: Updating an already `CLOSED` (`WIN`/`LOSS`/`SCRATCH`) `TradeRecord` to flip `outcomeResult` from `'LOSS'` to `'WIN'`.
9. **ID Poisoning Attack**: Creating a trade document with a 200-character or slash/symbol-injected `signalId` (`"bad$$id"` or 200 `'a'`s).
10. **Value / Resource Poisoning**: Writing a `strategyName` exceeding 200 characters or `outcomeResult: true` (wrong type) on an allowed update key.
11. **Timestamp Forgery**: Creating or updating a document with a backdated client timestamp instead of `request.time`, or mutating `createdAt` on update.
12. **Spoofed Unverified Admin Email**: Authenticating with `email: "mahammadhussain998@gmail.com"` while `email_verified: false` to bypass ownership or terminal locks.
