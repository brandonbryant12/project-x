# Coaching landscape research (2026-11-16)

Desk research done before the first ADRs. It covers what Salesforce offers for
coaching today, where that falls short, best-in-class patterns elsewhere, what
the evidence says about gamification, and constraints specific to financial
services. Treat vendor statistics as directional only. G2 pages could not be
fetched, so the complaints section leans on Salesforce's own documentation and
on secondary summaries.

## 1. What Salesforce offers

| Offering                                                                | What it is                                                                                                                                                                                                                                                    | Relevance                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Enablement / Sales Programs** (Sales Cloud add-on, "Guidance Center") | Programs → exercises → milestones → outcome. Progress is scored by **Measures**: filters over CRM records, such as completed Tasks whose subject contains "Call". Feedback Request exercises let the **rep pick their own reviewers**. About $100/user/month. | Most likely what "the Salesforce coaching app" refers to |
| **Einstein Conversation Insights**                                      | Timestamped manager comments on call recordings, key moments, playlists                                                                                                                                                                                       | Call-centric; wealth firms rarely record client meetings |
| **Agentforce Sales Coach** (2025)                                       | AI role-play and deal-grounded feedback                                                                                                                                                                                                                       | Separate license; setup friction reported                |
| **Work.com Coaching (`WorkCoaching`)**                                  | Coach–coachee relationship plus private notes                                                                                                                                                                                                                 | **Retired Spring '22**; unavailable from API v54         |
| **Financial Services Cloud (Wealth)**                                   | Households, AUM, advisor home                                                                                                                                                                                                                                 | **No native development or coaching module**             |

Sources: Trailhead _Enablement basics_ module; salesforceben.com, "Sales Programs";
Salesforce `WorkCoaching` object reference; Salesforce FSC Wealth product page.

## 2. Structural shortcomings of the Salesforce approach

1. **It measures logged activity, not demonstrated skill.** Measures count CRM
   records, which rewards logging calls rather than how well a discovery
   conversation went. Work that happens outside the CRM, such as book reviews
   or team conversations, does not count.
2. **Feedback depends on the rep asking for it.** Reps choose their own
   reviewers, so selection bias is built in. No flow lets an observer start a
   record with "I saw this and I confirm it".
3. **Data-entry burden.** Salesforce's _State of Sales_ puts non-selling time at
   about 60%. Coaching becomes one more form to fill in.
4. **UX and reporting.** G2 reviewers repeatedly call it "not intuitive" and
   "overwhelming", and say the report builder needs an admin.
5. **No skill model.** There is no governed skill ontology and no proficiency
   levels. A program is a bundle of content and milestones.
6. **Unstable platform for this use.** Work.com Coaching is retired. myTrailhead
   is reportedly being wound down. The Trailblazer forums go read-only on
   Oct 30, 2026.

## 3. Patterns worth borrowing

- **Entrustable Professional Activities (medical education)** is the closest
  analogy. Assessors ask "how much supervision did / will this person need for
  this activity?" on an ordinal 4–5 level entrustment scale. Long
  direct-observation forms (mini-CEX) decay into tick-boxes. A **single global
  rating plus one specific comment** (micro-CEX) increased both the quantity
  and the quality of feedback. _Programmatic assessment_: no single observation
  decides anything high-stakes; many low-stakes observations from several
  assessors are aggregated. (JGME 8(2); NUS TAPS micro-CEX; PMC10885268)
- **Self-assessment is unreliable.** Davis et al., _JAMA_ 2006, systematic
  review: in 13 of 20 comparisons, physicians' self-assessment showed little,
  no, or an _inverse_ relationship with observed competence. Accuracy was worst
  among the least skilled and most confident. This is the empirical case for
  "nothing posts on self-report".
- **Mindtickle Readiness Index.** Weighted competencies, rubric-scored coaching
  forms, and roll-ups by skill, manager and region.
- **Gong.** A manager _coaching inbox_ that shows who hasn't had feedback
  recently. _Coaching metrics_ let a manager's manager see how much each manager
  coaches. **Measure the coaches, not only the coachees.**
- **Lattice Grow.** Competency matrices by role and level; development plans
  that manager and employee co-create.
- **BetterUp.** Reflections stay confidential between coach and coachee.
  Business outcomes are studied **in aggregate**, never used for individual
  evaluation.
- **Workday Skills Cloud.** A curated ontology (about 1M raw skills reduced to
  about 55K verified). Levels are computed from several weighted sources on a
  1–5 scale.
- **Open Badges 3.0 (1EdTech, 2024).** Badges are W3C Verifiable Credentials
  with first-class **Evidence** and **Endorsement**. This maps directly onto
  "the observation is the evidence and the confirming coach is the endorser".
- **70-20-10.** A useful heuristic for building plans from real work. Its
  empirical basis is thin, so do not enforce the ratios.

## 4. Gamification: what holds up

- **Overjustification** (Deci, Koestner & Ryan 1999, meta-analysis of 128
  studies): tangible, expected, contingent rewards undermine intrinsic
  motivation, while informational feedback does far less harm. **Points must
  carry information about competence and must not work like pay.**
- **Sailer et al. 2017** (randomized): badges, leaderboards and performance
  graphs raise perceived competence; teammates and story raise relatedness.
  Gamification is "not effective per se".
- **Rank feedback can hurt.** In Barankay's field experiment, _removing_ rank
  feedback raised sales by about 11%, and benchmarks beat ranks. Public ranks
  had a net negative effect in Ashraf's study. Mandatory games lower engagement
  among people who did not opt in.
- **Octalysis.** Favor the white-hat drives (meaning, accomplishment,
  empowerment, feedback). Avoid scarcity, unpredictability and loss-aversion
  mechanics such as streak loss.

## 5. Financial-services specifics

- **CFP Board competency framework.** It has three clusters. _Technical_:
  needs analysis, advice, technology. _Interpersonal_: coaching, emotional
  intelligence, consulting. _Leadership_: professionalism, integrity, client
  advocacy. Clients rank **integrity** first. Vanguard's _Advisor's Alpha_
  values behavioral coaching of clients at about 1.5–2 percentage points a year.
- **Seed skill domains:** client discovery & needs analysis; planning & advice;
  behavioral coaching; trust & integrity; client communication &
  responsiveness; retention & relationship deepening; prospecting & referrals;
  compliance & suitability; team leadership.
- **FINRA 3110 (supervision).** Reviews must be _evidenced_: who reviewed what,
  when, and what action was taken. Coaching notes about specific client
  activity may become supervisory material.
- **FINRA 4511 / SEA 17a-4.** Retain records immutably, with corrections made
  as new entries. The default retention period is 6 years.
- **FINRA RN 24-09.** Existing rules apply to AI as they do to any other
  technology. Whether AI summaries count as books and records is still being
  worked out.
- **Reg S-P amendments** (compliance dates passed in 2025/2026): incident
  response and **service-provider oversight** for systems that hold customer
  information.
- **Design implication:** keep client PII _out_ of development records by
  default. Refer to client work by an opaque CRM reference at most. Get a
  compliance ruling on whether observations are books and records.
- **Industry programs:** Merrill's Advisor Development Program and its
  tenure-cohort "Level Up" taught by the next tier of advisors; Morgan Stanley's
  36-month FAA program with mentors; Edward Jones' 6-month learning plans and
  "Coaching Into Action"; RBC's dedicated practice-management coaches. The
  common mix is training, mentors, cohorts and coaches, which is close to our
  leader + coach mesh.

## 6. Principles carried into the product

1. Observed evidence is the only currency.
2. An observer can capture an observation in under 60 seconds after a meeting,
   on a phone: one global rating plus one specific comment.
3. Use an entrustment-style scale per skill. Points, if shown, are derived from
   it.
4. Many observations from many observers. Level changes require several
   observations from at least two distinct observers.
5. A governed, versioned catalog with behavioral descriptors per level.
6. Plans are built from upcoming real work, each item with an invited observer.
7. Observation can be requested by the coachee or started by the observer.
   Either way, the observer confirms.
8. Compliance by design: no client PII by default, append-only records, an
   audit trail, retention hooks.
9. Badges shaped like Open Badges 3.0, with evidence and an endorser.
10. Informational, non-competitive gamification: personal trajectory and
    criterion benchmarks, no public individual leaderboards, no streak loss.
11. Specific recognition that quotes the observer's evidence note.
12. Coach-the-coach analytics and a coaching inbox.
13. Rater calibration, with lenient or harsh outliers flagged.
14. Support for cohorts and peer mentoring alongside formal relationships.
15. Private reflections stay separate from confirmed, shareable evidence.
    Business outcomes are studied only in aggregate.
