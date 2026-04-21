-- Reframe "replace the founder / founder-independent / founder-dependent"
-- language in two KB docs to "scale the founder / codify tribal knowledge".
-- See app/api/chat/prompt.txt "FOUNDER LEVERAGE" section and
-- supabase/functions/outreach-drafter/index.ts "FOUNDER LEVERAGE FRAMING" block
-- for the matching rules enforced at inference time.
--
-- Safe to re-run; each REPLACE is a no-op once the swap is in place.

BEGIN;

-- =========================================================================
-- Core Narrative (aa1b0255-f060-4efb-810d-092331d5f579)
-- =========================================================================

-- Note: the source doc uses curly apostrophes (U+2019), not straight '.
-- Keep the ’ character intact or the swap will no-op.
UPDATE reference_library SET content = REPLACE(content,
  'Deals are founder-dependent—close when you’re in the room, die when you’re not.',
  'Deals hinge on instincts only you have — they close when you’re in the room because the tribal knowledge behind the play hasn’t been codified for anyone else to run.'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  'You’re personally involved in every deal that closes (founder-dependent)',
  'You’re personally involved in every deal that closes (the tribal knowledge behind the wins hasn’t been codified for anyone else)'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  'Repeatable methodology (not founder-dependent heroics)',
  'Repeatable methodology (codifies what the founder already does, not unrepeatable heroics)'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  'Repeatable methodology your team can execute without founder in every deal',
  'Repeatable methodology that codifies what the founder already does, so the team can execute it with the founder focused on the highest-leverage moves'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  'Build predictable pipeline independent of founder relationships.',
  E'Build predictable pipeline that scales the founder\'s pattern recognition into a system the team can run.'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  E'You\'ve converted 1-3 pilots using founder-led heroics and relationship leverage.',
  E'You\'ve converted 1-3 pilots through founder-led instincts and relationship leverage — moves that lived in your head, not in a playbook.'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  E'Your board needs proof this can work systematically—that commercial success isn\'t dependent on you being in every deal.',
  'Your board needs proof this can work systematically—that the tribal knowledge driving your wins has been codified so the team can run the same play.'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  'Healthcare Sales Playbook (Systematic, Founder-Independent)',
  'Healthcare Sales Playbook (Systematic, Team-Operable)'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  'Repeatable execution frameworks that enable team to close deals without founder',
  'Repeatable execution frameworks that codify what the founder does so the team can run the same play'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  'Healthcare sales playbook (founder-independent execution with ICP qualification built in)',
  'Healthcare sales playbook (team-operable execution with ICP qualification built in)'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

-- Variant in Elevator Pitches Phase 3 bullet (different wording than Core Narrative).
UPDATE reference_library SET content = REPLACE(content,
  'Healthcare sales playbook (founder-independent, ICP qualification built in)',
  'Healthcare sales playbook (team-operable, ICP qualification built in)'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

UPDATE reference_library SET content = REPLACE(content,
  'Prove to your board and Series B investors that you have repeatable commercial infrastructure, not just founder-led relationship wins.',
  'Prove to your board and Series B investors that you have repeatable commercial infrastructure that codifies what drove your founder-led wins — not unrepeatable heroics.'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  E'Founder-led sales (team can\'t close without founder)',
  E'Founder-led sales (tribal knowledge driving wins hasn\'t been codified for the team)'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

UPDATE reference_library SET content = REPLACE(content,
  'Founder dependency (deals close when founder involved, stall when not)',
  E'Tribal knowledge gap (deals close when founder is in the room because the play hasn\'t been codified for the team)'
) WHERE id = 'aa1b0255-f060-4efb-810d-092331d5f579';

-- =========================================================================
-- Elevator Pitches (17859c40-0b96-4079-96a5-7080a30ede8c)
-- =========================================================================

UPDATE reference_library SET content = REPLACE(content,
  E'Deals are founder-dependent—close when you\'re in the room, die when you\'re not.',
  E'Deals hinge on tribal knowledge only you have — they close when you\'re in the room because the play hasn\'t been codified for anyone else to run.'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

UPDATE reference_library SET content = REPLACE(content,
  'Repeatable methodology your team can execute without founder in every deal',
  'Repeatable methodology that codifies what the founder already does, so the team can execute it with the founder focused on the highest-leverage moves'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

UPDATE reference_library SET content = REPLACE(content,
  'Framing 4: Founder Dependency (Board Pressure)',
  'Framing 4: Founder Leverage (Board Pressure)'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

UPDATE reference_library SET content = REPLACE(content,
  E'Hook: "Deals close when you\'re in the room. They die when you\'re not."',
  E'Hook: "Your wins run on instincts only you have — which means the team can\'t close what you\'re not in the room for."'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

UPDATE reference_library SET content = REPLACE(content,
  E'Evidence: "You\'ve converted 2-3 pilots through founder heroics. Your board needs proof this can work systematically—that it\'s not dependent on you."',
  E'Evidence: "You\'ve converted 2-3 pilots through founder-led instincts. Your board needs proof the tribal knowledge behind those wins has been codified — that the team can run the same play with the founder focused on the highest-leverage moves."'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

UPDATE reference_library SET content = REPLACE(content,
  E'Why: "You have founder-led relationship wins. You need repeatable commercial infrastructure that enables your team to execute—starting with knowing which hospitals to target and how to qualify them."',
  E'Why: "Your relationship-led wins work — but the tribal knowledge behind them lives in your head, not in a system the team can run. You need repeatable commercial infrastructure that codifies those moves — starting with knowing which hospitals to target and how to qualify them."'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

UPDATE reference_library SET content = REPLACE(content,
  E'Solution: "We build systematic playbooks, frameworks, and processes that prove commercial traction to Series B investors—not just founder magic."',
  E'Solution: "We build systematic playbooks, frameworks, and processes that codify the tribal knowledge behind your founder-led wins — so Series B investors see a repeatable system, not unrepeatable moves."'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

UPDATE reference_library SET content = REPLACE(content,
  E'prove this isn\'t just founder-led heroics—starting with Sales 101',
  E'prove you\'ve codified the tribal knowledge behind your founder-led wins so the team can run the same play—starting with Sales 101'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

UPDATE reference_library SET content = REPLACE(content,
  E'If your team is struggling to close hospital deals without the founder in the room, the problem isn\'t your people—it\'s missing infrastructure.',
  E'If your team is struggling to close hospital deals the way the founder closes them, the problem isn\'t your people — it\'s that the tribal knowledge in the founder\'s head hasn\'t been codified into an infrastructure they can execute.'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

UPDATE reference_library SET content = REPLACE(content,
  'We build the systematic infrastructure that enables your team to execute, not just the founder.',
  'We build the systematic infrastructure that codifies what the founder does so the team can run the same play.'
) WHERE id = '17859c40-0b96-4079-96a5-7080a30ede8c';

COMMIT;

-- Verify: neither doc should contain the old slanted phrases anymore.
SELECT id, title,
  (content LIKE '%founder-independent%') AS has_founder_independent,
  (content LIKE '%founder-dependent%') AS has_founder_dependent,
  (content LIKE '%without founder in every deal%') AS has_without_founder,
  (content LIKE '%founder magic%') AS has_founder_magic
FROM reference_library
WHERE id IN ('aa1b0255-f060-4efb-810d-092331d5f579', '17859c40-0b96-4079-96a5-7080a30ede8c');
