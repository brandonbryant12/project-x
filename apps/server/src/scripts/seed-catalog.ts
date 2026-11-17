import type { InteractionKind, SkillDomain } from '@repo/domain';

/**
 * Starter catalog for a wealth-management firm (fictional content, written to
 * be observable behavior, not traits — docs/research § 5). Each level has
 * indicators an observer can actually see. A real tenant's keepers replace this.
 */
export interface SeedSkill {
  readonly slug: string;
  readonly name: string;
  readonly domain: SkillDomain;
  readonly summary: string;
  readonly outcome: string;
  readonly tags: ReadonlyArray<string>;
  readonly levels: readonly [SeedLevel, SeedLevel, SeedLevel, SeedLevel];
}
interface SeedLevel {
  readonly summary: string;
  readonly indicators: ReadonlyArray<readonly [lineageKey: string, text: string]>;
}

export const SEED_SKILLS: ReadonlyArray<SeedSkill> = [
  {
    slug: 'client-discovery',
    name: 'Client discovery',
    domain: 'client_discovery',
    summary:
      'Uncovers what a client actually wants their money to do, before talking about products.',
    outcome: 'Client trust',
    tags: ['meetings', 'new clients'],
    levels: [
      {
        summary: 'Follows a discovery checklist with support.',
        indicators: [
          ['l1-uses-guide', 'Works through the discovery guide without skipping sections'],
          ['l1-records-goals', 'Writes down the goals the client states in their own words'],
        ],
      },
      {
        summary: 'Asks open questions; still steers toward familiar topics.',
        indicators: [
          ['l2-open-questions', 'Asks open questions about what matters to the client'],
          ['l2-lets-client-talk', 'Lets the client finish before responding'],
          ['l2-confirms', 'Confirms understanding by repeating key points back'],
        ],
      },
      {
        summary: 'Leads a discovery conversation that changes the plan.',
        indicators: [
          ['l3-surfaces-unstated', 'Surfaces a goal or worry the client had not stated'],
          [
            'l3-summarizes-before-advice',
            'Summarizes the client’s priorities before discussing any solution',
          ],
          ['l3-explores-tradeoffs', 'Explores how the client feels about trade-offs between goals'],
        ],
      },
      {
        summary: 'Helps colleagues run better discovery.',
        indicators: [
          ['l4-models', 'Models a discovery conversation for a colleague and debriefs it'],
          ['l4-feedback', 'Gives a colleague specific feedback on their questions'],
          ['l4-improves-guide', 'Improves the team’s discovery guide from real meetings'],
        ],
      },
    ],
  },
  {
    slug: 'goals-based-planning',
    name: 'Goals-based planning',
    domain: 'planning_advice',
    summary: 'Turns a client’s goals into a plan they understand and act on.',
    outcome: 'Plan adoption',
    tags: ['planning'],
    levels: [
      {
        summary: 'Builds a plan from a template with review.',
        indicators: [
          ['l1-uses-tool', 'Enters goals and assumptions in the planning tool accurately'],
          ['l1-asks-review', 'Asks for a review before presenting a plan'],
        ],
      },
      {
        summary: 'Connects recommendations to stated goals.',
        indicators: [
          ['l2-links-goals', 'Links each recommendation to a goal the client named'],
          ['l2-explains-assumptions', 'States the key assumptions behind the plan'],
          ['l2-next-steps', 'Agrees concrete next steps with the client'],
        ],
      },
      {
        summary: 'Adapts the plan in the conversation as priorities shift.',
        indicators: [
          ['l3-scenarios', 'Shows a scenario that answers a client’s “what if” on the spot'],
          ['l3-prioritizes', 'Helps the client prioritize when goals compete'],
          [
            'l3-checks-commitment',
            'Checks the client is committed to each step, not just agreeable',
          ],
        ],
      },
      {
        summary: 'Raises the planning standard of the team.',
        indicators: [
          ['l4-reviews-plans', 'Reviews a colleague’s plan and improves its logic'],
          ['l4-teaches-scenarios', 'Teaches others to use scenarios in client meetings'],
          ['l4-shares-patterns', 'Shares patterns from plans that clients acted on'],
        ],
      },
    ],
  },
  {
    slug: 'behavioral-coaching',
    name: 'Behavioral coaching',
    domain: 'behavioral_coaching',
    summary: 'Helps clients stay the course when markets or emotions push them off it.',
    outcome: 'Client retention through volatility',
    tags: ['volatility', 'retention'],
    levels: [
      {
        summary: 'Reassures with facts from a script.',
        indicators: [
          ['l1-uses-talking-points', 'Uses the firm’s market talking points accurately'],
          ['l1-escalates', 'Brings a worried client’s concerns to a senior colleague'],
        ],
      },
      {
        summary: 'Acknowledges emotion before discussing the plan.',
        indicators: [
          ['l2-acknowledges', 'Names the client’s concern before offering information'],
          ['l2-reconnects-goals', 'Reconnects the conversation to the client’s long-term goals'],
          ['l2-avoids-predictions', 'Avoids predicting short-term market moves'],
        ],
      },
      {
        summary: 'Changes the client’s decision without pressure.',
        indicators: [
          ['l3-reframes', 'Reframes a short-term fear in terms of the client’s own plan'],
          ['l3-asks-not-tells', 'Asks questions that let the client reach the decision themselves'],
          ['l3-agrees-checkpoint', 'Agrees a checkpoint instead of an impulsive change'],
        ],
      },
      {
        summary: 'Prepares the team for difficult markets.',
        indicators: [
          ['l4-rehearses', 'Rehearses volatility conversations with colleagues'],
          ['l4-debriefs', 'Debriefs difficult calls with a colleague afterward'],
          ['l4-shares-language', 'Shares language that worked with the team'],
        ],
      },
    ],
  },
  {
    slug: 'explaining-simply',
    name: 'Explaining complex ideas simply',
    domain: 'communication',
    summary: 'Makes complex financial ideas clear without jargon or condescension.',
    outcome: 'Client understanding',
    tags: ['communication'],
    levels: [
      {
        summary: 'Explains accurately using prepared material.',
        indicators: [
          ['l1-accurate', 'Explains a product or concept accurately using prepared material'],
          ['l1-checks-questions', 'Asks if the client has questions'],
        ],
      },
      {
        summary: 'Uses plain language and checks understanding.',
        indicators: [
          ['l2-plain-language', 'Replaces jargon with plain language'],
          ['l2-teach-back', 'Asks the client to explain it back in their own words'],
          ['l2-one-idea', 'Covers one idea at a time'],
        ],
      },
      {
        summary: 'Tailors the explanation to the person in front of them.',
        indicators: [
          ['l3-analogy', 'Uses an analogy drawn from the client’s own life'],
          ['l3-visual', 'Draws or shows a simple picture to make a point'],
          ['l3-adjusts', 'Adjusts the explanation when the client looks unsure'],
        ],
      },
      {
        summary: 'Helps others explain clearly.',
        indicators: [
          ['l4-rewrites', 'Rewrites a colleague’s explanation to be clearer'],
          ['l4-coaches', 'Coaches a colleague before a complex explanation'],
          ['l4-library', 'Adds a proven explanation to the team’s library'],
        ],
      },
    ],
  },
  {
    slug: 'transparency',
    name: 'Trust and transparency',
    domain: 'trust_integrity',
    summary: 'Is open about fees, conflicts and limits, so clients never feel surprised.',
    outcome: 'Client trust',
    tags: ['fees', 'conflicts'],
    levels: [
      {
        summary: 'Discloses what is required, when prompted.',
        indicators: [
          ['l1-required-disclosures', 'Delivers required disclosures accurately'],
          ['l1-escalates-questions', 'Escalates fee questions they cannot answer'],
        ],
      },
      {
        summary: 'Raises fees and conflicts without being asked.',
        indicators: [
          ['l2-raises-fees', 'Raises fees before the client asks'],
          ['l2-explains-conflicts', 'Explains how they are paid in plain terms'],
          ['l2-admits-limits', 'Says “I don’t know, I will find out” when unsure'],
        ],
      },
      {
        summary: 'Turns transparency into trust.',
        indicators: [
          ['l3-compares', 'Explains what the client gets for the fee compared with alternatives'],
          ['l3-bad-news', 'Delivers bad news early and with a plan'],
          ['l3-invites-challenge', 'Invites the client to challenge a recommendation'],
        ],
      },
      {
        summary: 'Sets the standard for candor on the team.',
        indicators: [
          ['l4-models-candor', 'Models a difficult disclosure conversation for a colleague'],
          ['l4-reviews', 'Reviews how a colleague handled a fee objection'],
          ['l4-raises-issues', 'Raises a team practice that could surprise clients'],
        ],
      },
    ],
  },
  {
    slug: 'relationship-deepening',
    name: 'Relationship deepening',
    domain: 'relationship_growth',
    summary: 'Grows relationships across the household and across generations.',
    outcome: 'Retained and growing books',
    tags: ['households', 'next generation'],
    levels: [
      {
        summary: 'Keeps contact regular and accurate.',
        indicators: [
          ['l1-cadence', 'Keeps to the agreed contact schedule'],
          ['l1-records', 'Records household relationships accurately'],
        ],
      },
      {
        summary: 'Engages the wider household.',
        indicators: [
          ['l2-invites-spouse', 'Invites the spouse or partner into planning conversations'],
          ['l2-asks-family', 'Asks about family members who rely on the plan'],
          ['l2-follows-up', 'Follows up on a personal detail from the last conversation'],
        ],
      },
      {
        summary: 'Earns introductions without asking for them crudely.',
        indicators: [
          ['l3-next-gen', 'Meets the next generation on their own terms'],
          ['l3-value-ask', 'Asks for an introduction by explaining who they help best'],
          ['l3-professional-network', 'Collaborates with the client’s accountant or attorney'],
        ],
      },
      {
        summary: 'Builds the team’s relationship practices.',
        indicators: [
          ['l4-shares-approach', 'Shares an approach to multigenerational meetings with the team'],
          ['l4-joint', 'Brings a junior colleague into a family meeting and debriefs it'],
          ['l4-designs', 'Designs a household engagement plan the team uses'],
        ],
      },
    ],
  },
  {
    slug: 'book-stewardship',
    name: 'Book stewardship',
    domain: 'relationship_growth',
    summary: 'Runs a disciplined review of the book: who needs attention, and why.',
    outcome: 'Retained and growing books',
    tags: ['book reviews'],
    levels: [
      {
        summary: 'Prepares the book data for review.',
        indicators: [
          ['l1-prepares', 'Brings accurate book data to the review'],
          ['l1-flags', 'Flags clients they have not contacted recently'],
        ],
      },
      {
        summary: 'Segments the book and sets priorities.',
        indicators: [
          ['l2-segments', 'Segments clients by need, not only by assets'],
          ['l2-priorities', 'Leaves the review with named priority clients'],
          ['l2-risk', 'Identifies relationships at risk and why'],
        ],
      },
      {
        summary: 'Turns the review into a plan they follow.',
        indicators: [
          ['l3-plans', 'Sets specific actions with dates for priority clients'],
          ['l3-follows-through', 'Reports progress on last review’s actions'],
          ['l3-capacity', 'Matches service model to their real capacity'],
        ],
      },
      {
        summary: 'Improves how the team reviews books.',
        indicators: [
          ['l4-facilitates', 'Facilitates a colleague’s book review'],
          ['l4-template', 'Improves the team’s review template'],
          ['l4-mentors', 'Mentors a colleague on prioritization'],
        ],
      },
    ],
  },
  {
    slug: 'coaching-your-team',
    name: 'Coaching your team',
    domain: 'leadership',
    summary: 'Develops people through observation and specific feedback, not just targets.',
    outcome: 'Team capability',
    tags: ['leadership', 'coaching'],
    levels: [
      {
        summary: 'Holds regular one-to-ones.',
        indicators: [
          ['l1-cadence', 'Holds one-to-ones on schedule'],
          ['l1-listens', 'Asks what support the person needs'],
        ],
      },
      {
        summary: 'Observes real work and gives specific feedback.',
        indicators: [
          ['l2-observes', 'Observes a colleague’s real client work'],
          ['l2-specific', 'Gives feedback that names a specific behavior'],
          ['l2-next-step', 'Agrees a concrete next step with the person'],
        ],
      },
      {
        summary: 'Builds the person’s own judgment.',
        indicators: [
          ['l3-asks', 'Asks questions that help the person assess their own work'],
          ['l3-follows-up', 'Follows up on the agreed next step'],
          ['l3-stretch', 'Gives the person a stretch assignment with support'],
        ],
      },
      {
        summary: 'Develops other coaches and leaders.',
        indicators: [
          ['l4-coaches-coaches', 'Coaches another leader on their coaching'],
          ['l4-calibrates', 'Calibrates observation standards with other observers'],
          ['l4-culture', 'Makes observation part of how the team works'],
        ],
      },
    ],
  },
];

export interface SeedTemplate {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly kind: InteractionKind;
  readonly skills: ReadonlyArray<string>;
  readonly minutes: number;
  readonly tip: string;
}

export const SEED_TEMPLATES: ReadonlyArray<SeedTemplate> = [
  {
    slug: 'discovery-meeting',
    name: 'Discovery meeting with a new client',
    description:
      'A first substantive meeting to understand what the client wants their money to do.',
    kind: 'client_meeting',
    skills: ['client-discovery', 'explaining-simply'],
    minutes: 60,
    tip: 'Watch the first ten minutes: who talks more, and what gets summarized.',
  },
  {
    slug: 'annual-review',
    name: 'Annual plan review',
    description: 'Review progress against the plan and reset priorities with the household.',
    kind: 'client_meeting',
    skills: ['goals-based-planning', 'relationship-deepening'],
    minutes: 60,
    tip: 'Listen for whether goals are re-confirmed or assumed.',
  },
  {
    slug: 'volatility-check-in',
    name: 'Market-volatility check-in call',
    description: 'Proactive call to a client likely to be anxious after a market move.',
    kind: 'client_meeting',
    skills: ['behavioral-coaching'],
    minutes: 20,
    tip: 'Notice whether emotion is acknowledged before facts.',
  },
  {
    slug: 'book-review',
    name: 'Book review with your leader',
    description: 'A structured review of the book: priorities, risks and actions.',
    kind: 'book_review',
    skills: ['book-stewardship'],
    minutes: 45,
    tip: 'Look for named clients and dated actions, not general intentions.',
  },
  {
    slug: 'fees-conversation',
    name: 'Fees and conflicts conversation',
    description: 'Explaining how you are paid and what the client gets for the fee.',
    kind: 'client_meeting',
    skills: ['transparency', 'explaining-simply'],
    minutes: 30,
    tip: 'Did the advisor raise it before being asked?',
  },
  {
    slug: 'introduction-conversation',
    name: 'Introduction conversation',
    description: 'Asking a satisfied client to introduce someone they think you could help.',
    kind: 'client_meeting',
    skills: ['relationship-deepening'],
    minutes: 15,
    tip: 'Is the ask grounded in who the advisor helps best?',
  },
  {
    slug: 'team-huddle',
    name: 'Team huddle you lead',
    description: 'A short team meeting you run to share learning or solve a problem.',
    kind: 'team_conversation',
    skills: ['coaching-your-team'],
    minutes: 30,
    tip: 'Who speaks, and does anyone leave with a specific next step?',
  },
  {
    slug: 'proposal-walkthrough',
    name: 'Walking a household through a proposal',
    description: 'Explaining a recommendation to everyone who has a say in the decision.',
    kind: 'presentation',
    skills: ['explaining-simply', 'goals-based-planning'],
    minutes: 45,
    tip: 'Watch for teach-back and for the quieter partner’s questions.',
  },
  {
    slug: 'joint-meeting',
    name: 'Joint meeting with a specialist',
    description: 'A client meeting run together with a planning, tax or lending specialist.',
    kind: 'client_meeting',
    skills: ['relationship-deepening', 'transparency'],
    minutes: 60,
    tip: 'Who leads, and how is the specialist introduced?',
  },
  {
    slug: 'next-gen-meeting',
    name: 'Meeting the next generation',
    description: 'A conversation with an adult child or heir of an existing client.',
    kind: 'client_meeting',
    skills: ['relationship-deepening', 'client-discovery'],
    minutes: 45,
    tip: 'Is the conversation about their goals, or their parents’ assets?',
  },
];
