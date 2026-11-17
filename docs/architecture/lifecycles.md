# Lifecycles

> Generated from `packages/domain/src/lifecycles/*.ts` by `pnpm docs:lifecycles`. Do not edit by hand.
> (human) = only a person can send it · (system) = sweep or automatic screening · `[guard]` = condition the machine evaluates.
> Who may send each human event is decided by policy (docs/architecture/identity-and-access.md § 5).

## observation

States: `requested`, `drafting`, `returned`, `signed`, `under_review`, `declined`, `withdrawn`, `expired`, `voided` · terminal: `declined`, `withdrawn`, `expired`, `voided`

```mermaid
stateDiagram-v2
  direction LR
  [*] --> requested
  [*] --> drafting
  requested --> drafting : START
  requested --> drafting : SAVE_DRAFT
  requested --> signed : SIGN [readyToSign] (human)
  requested --> returned : RETURN (human)
  requested --> declined : DECLINE (human)
  requested --> withdrawn : WITHDRAW (human)
  requested --> expired : EXPIRE (system)
  drafting --> drafting : SAVE_DRAFT
  drafting --> signed : SIGN [readyToSign] (human)
  drafting --> returned : RETURN (human)
  drafting --> declined : DECLINE (human)
  drafting --> withdrawn : WITHDRAW (human)
  drafting --> expired : EXPIRE (system)
  returned --> requested : RESUBMIT (human)
  returned --> withdrawn : WITHDRAW (human)
  returned --> expired : EXPIRE (system)
  signed --> signed : ACKNOWLEDGE [notAcknowledged] (human)
  signed --> under_review : REQUEST_REVIEW [notAcknowledged] (human)
  signed --> voided : VOID (human)
  under_review --> signed : UPHOLD (human)
  under_review --> voided : VOID (human)
  declined --> [*]
  withdrawn --> [*]
  expired --> [*]
  voided --> [*]
```

## engagement

States: `proposed`, `active`, `paused`, `ended`, `declined`, `withdrawn`, `expired` · terminal: `ended`, `declined`, `withdrawn`, `expired`

```mermaid
stateDiagram-v2
  direction LR
  [*] --> proposed
  proposed --> active : ACCEPT [coachGrantActive] (human)
  proposed --> declined : DECLINE (human)
  proposed --> withdrawn : WITHDRAW (human)
  proposed --> expired : EXPIRE (system)
  active --> paused : PAUSE
  active --> ended : END
  paused --> active : RESUME [coachGrantActive]
  paused --> ended : END
  ended --> [*]
  declined --> [*]
  withdrawn --> [*]
  expired --> [*]
```

## plan

States: `draft`, `proposed`, `active`, `paused`, `completed`, `canceled`, `expired` · terminal: `completed`, `canceled`, `expired`

```mermaid
stateDiagram-v2
  direction LR
  [*] --> draft
  draft --> proposed : PROPOSE [proposable]
  draft --> canceled : CANCEL (human)
  proposed --> active : AGREE (human)
  proposed --> draft : REVISE
  proposed --> proposed : ENDORSE [notEndorsed] (human)
  proposed --> canceled : CANCEL (human)
  proposed --> expired : EXPIRE (system)
  active --> active : ENDORSE [notEndorsed] (human)
  active --> paused : PAUSE
  active --> completed : COMPLETE (human)
  active --> canceled : CANCEL (human)
  active --> expired : EXPIRE (system)
  paused --> active : RESUME
  paused --> canceled : CANCEL (human)
  paused --> expired : EXPIRE (system)
  completed --> [*]
  canceled --> [*]
  expired --> [*]
```

## activity

States: `planned`, `underway`, `done`, `canceled`, `expired` · terminal: `done`, `canceled`, `expired`

```mermaid
stateDiagram-v2
  direction LR
  [*] --> planned
  [*] --> underway
  planned --> underway : LOG_INTERACTION (system)
  planned --> canceled : CANCEL (human)
  planned --> expired : EXPIRE (system)
  underway --> underway : LOG_INTERACTION (system)
  underway --> done : COMPLETE (human)
  underway --> canceled : CANCEL (human)
  done --> [*]
  canceled --> [*]
  expired --> [*]
```

## evidence

States: `screening`, `held`, `escalated`, `available` · terminal: none

```mermaid
stateDiagram-v2
  direction LR
  [*] --> screening
  screening --> available : CLEAR (system)
  screening --> held : HOLD (system)
  screening --> escalated : ESCALATE (system)
  held --> screening : REVISE
  held --> available : RELEASE (human)
  escalated --> available : RESOLVE (human)
  available --> screening : REVISE
  available --> held : HOLD (system)
  available --> escalated : ESCALATE (system)
```

## catalogItem

States: `draft`, `published`, `retired`, `discarded` · terminal: `retired`, `discarded`

```mermaid
stateDiagram-v2
  direction LR
  [*] --> draft
  [*] --> published
  draft --> published : PUBLISH [complete] (human)
  draft --> discarded : DISCARD
  published --> retired : RETIRE
  retired --> [*]
  discarded --> [*]
```

## advisoryCheck

States: `pending`, `completed`, `failed`, `skipped` · terminal: `completed`, `failed`, `skipped`

```mermaid
stateDiagram-v2
  direction LR
  [*] --> pending
  pending --> completed : COMPLETE (human)
  pending --> failed : FAIL (system)
  pending --> skipped : SKIP (system)
  completed --> [*]
  failed --> [*]
  skipped --> [*]
```

## badgeAward

States: `awarded`, `revoked` · terminal: `revoked`

```mermaid
stateDiagram-v2
  direction LR
  [*] --> awarded
  awarded --> revoked : REVOKE
  revoked --> [*]
```

## directory exception

States: `open`, `acknowledged`, `resolved` · terminal: `resolved`

```mermaid
stateDiagram-v2
  direction LR
  [*] --> open
  open --> acknowledged : ACKNOWLEDGE (human)
  open --> resolved : RESOLVE (human)
  acknowledged --> resolved : RESOLVE (human)
  resolved --> [*]
```
