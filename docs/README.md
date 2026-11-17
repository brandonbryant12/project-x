# Documentation

Start with the overview for your role. Each page links to its details.

## Product: what and why

| Page                                                                             | Read it to…                                                                             |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [Product overview](product/overview.md)                                          | Understand the product on one page, with diagrams                                       |
| [Vision and principles](product/vision.md)                                       | Know what we optimize for and how we measure it                                         |
| [Domain model](product/domain-model.md)                                          | Learn the rules: entities, invariants, eligibility, recognition, lifecycles, visibility |
| [UX brief](product/ux-brief.md)                                                  | Follow the design contract: screens, copy, tokens                                       |
| [Open questions](product/open-questions.md)                                      | See owner decisions, each with its working default                                      |
| [Questions for domain experts](product/domain-expert-questions.md)               | Prepare interviews with coaches, leaders, compliance, HR and IT                         |
| [Coaching landscape research](archive/research/2026-11-16-coaching-landscape.md) | Read the evidence behind the design                                                     |

## Architecture: how

| Page                                                       | Read it to…                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Architecture overview](architecture/overview.md)          | See context, containers, request flow, AI flow, data model and deployment as diagrams |
| [Data model](architecture/data-model.md)                   | Learn the table rules and the schema review checklist                                 |
| [Lifecycles](architecture/lifecycles.md)                   | See every state machine (generated from code)                                         |
| [Identity and access](architecture/identity-and-access.md) | Understand Entra sign-in, AD groups to app roles, sessions, authorization, tenancy    |
| [ADRs](adr/README.md)                                      | Find decisions and their reasons                                                      |

## Engineering

| Page                                                                                   | Read it to…                                               |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [Agent guide](../AGENTS.md)                                                            | Learn the rules for anyone, human or agent, changing code |
| [Decision framework](engineering/decision-making.md)                                   | Know what needs an ADR, a human or a domain expert        |
| [Testing strategy](testing/strategy.md) and [invariants](testing/invariants.md)        | Know what to test and why                                 |
| [QA skill](../.claude/skills/qa/SKILL.md) and [report template](qa/report-template.md) | Run exploratory QA of a journey                           |

## Governance

| Page                                           | Read it to…                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| [Controls matrix](compliance/controls.md)      | Map SOC 2, FINRA/SEC and AI governance requirements to mechanisms and evidence |
| [AI system card](compliance/ai-system-card.md) | Prepare for the AI board review                                                |

## Operations

| Page                                                  | Read it to…                                            |
| ----------------------------------------------------- | ------------------------------------------------------ |
| [Incident response](runbooks/incident-response.md)    | Contain and record an incident with today's levers     |
| [Deprovisioning a leaver](runbooks/deprovisioning.md) | Remove someone's access now, and know what is kept     |
| [Backup and restore](runbooks/backup-and-restore.md)  | Restore to a point in time without reviving old access |
