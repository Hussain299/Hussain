/**
 * SignalForge ML — Firestore Security Rules Adversarial Test Specification (Phase 0 TDD)
 * Verifies all "Dirty Dozen" adversarial payloads are rejected by firestore.rules.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email?: string; email_verified?: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Unauthenticated read on private trade ledger',
    operation: 'get',
    path: '/users/user_a/tradeLedger/sig_001',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified email write on trade ledger',
    operation: 'create',
    path: '/users/user_a/tradeLedger/sig_001',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: false },
    payload: { id: 'sig_001', ownerId: 'user_a', symbol: 'EUR/USD', direction: 'BUY' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-user PII profile read',
    operation: 'get',
    path: '/users/user_a',
    auth: { uid: 'user_b', email: 'b@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-user trade ledger list scrape',
    operation: 'list',
    path: '/users/user_a/tradeLedger',
    auth: { uid: 'user_b', email: 'b@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Identity spoofing via mismatched ownerId',
    operation: 'create',
    path: '/users/user_a/tradeLedger/sig_spoof',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { id: 'sig_spoof', ownerId: 'user_b', symbol: 'EUR/USD', direction: 'BUY' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Self-assigned admin role escalation',
    operation: 'create',
    path: '/users/user_a',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { uid: 'user_a', displayName: 'Attacker', email: 'a@example.com', role: 'admin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Shadow/ghost field injection',
    operation: 'create',
    path: '/users/user_a/tradeLedger/sig_ghost',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { id: 'sig_ghost', ownerId: 'user_a', isVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Terminal settlement tampering (flipping LOSS to WIN)',
    operation: 'update',
    path: '/users/user_a/tradeLedger/sig_closed_loss',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { outcomeResult: 'WIN', netReturnUnits: 0.8 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'ID poisoning attack with invalid/oversized signalId',
    operation: 'create',
    path: `/users/user_a/tradeLedger/${'a'.repeat(150)}`,
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { id: 'a'.repeat(150), ownerId: 'user_a' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Value poisoning with invalid type on whitelisted update field',
    operation: 'update',
    path: '/users/user_a/tradeLedger/sig_active_1',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { outcomeResult: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Timestamp forgery / mutating immortal createdAt',
    operation: 'update',
    path: '/users/user_a/tradeLedger/sig_active_1',
    auth: { uid: 'user_a', email: 'a@example.com', email_verified: true },
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unverified admin email spoof attack',
    operation: 'get',
    path: '/users/user_a',
    auth: { uid: 'attacker_uid', email: 'mahammadhussain998@gmail.com', email_verified: false },
    expected: 'PERMISSION_DENIED',
  },
];
