# Shadow Online Learning

SignalForge retains its existing AGI, MLP, LinUCB and strategy-bandit systems. The additional online learner is an independent **shadow-only** model.

## Learning contract

- A 19-dimensional market feature vector is frozen when a signal is created, using only real candles available at prediction time.
- The FTRL-Proximal classifier augments that vector with an intercept, one-hot pair identity, direction and one-hot strategy family (47 total inputs).
- A prediction is scored only after a filled contract is fully closed with a WIN or LOSS. Unfilled, cancelled and scratch outcomes are not directional labels.
- Evaluation uses the stored prediction probability (prequential Brier score and log loss). The model gradient uses the current model state when delayed feedback arrives.
- Recovery replay orders prediction and outcome events by event time. A result is not available to a later prediction until its recorded settlement time.
- Drift detection reports a change in prequential error. It does not reset the model or alter signal eligibility.

## Separation from execution

The learner is never used for entry timing, signal direction, confidence gating, payout validation, strategy promotion, broker execution or position sizing. Its predictions and diagnostics are telemetry only.

## Crash recovery

The settled signal is synchronously persisted before downstream learning or derived ledgers are updated. Lifetime idempotency ledgers track forward observations, strategy outcomes and shadow learner training independently of the capped UI history. Startup reconciliation repairs missing derived records from filled, CLOSED signals.

Diagnostics:
- `GET /api/evolution/diagnostics`
- `POST /api/evolution/reconcile`

Raw feature vectors and credentials are never returned by the diagnostics endpoint.
