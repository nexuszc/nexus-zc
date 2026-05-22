-- Migration 024: Facebook content calendar days 31–90 (Jun 21 – Aug 19, 2026)
-- 60 facebook_group posts + 60 facebook_page posts = 120 total
-- Picks up where migration 021 left off (days 1–30 = May 22 – Jun 20)
-- Categories: supplement_tips, homeowner_communication, storm_strategy, business_ops,
--             lead_gen, carrier_intelligence, code_compliance, technology_tools

INSERT INTO roofing_content
  (type, format, channel, title, hook, body, status, topic_category, schedule_date)
VALUES

-- ══════════════════════════════════════════════════════════════════════════════
-- FACEBOOK GROUP  (days 31–60, Jun 21 – Jul 20)
-- ══════════════════════════════════════════════════════════════════════════════

-- Jun 21 — code_compliance
('facebook_post','social','facebook_group',
 'Did your last estimate include all code-required ventilation?',
 'One line item adjusters love to cut — and it''s easy to fight back.',
 E'IRC 2018 requires 1:150 net free area for attic ventilation unless a vapor retarder is present (1:300). Most estimates I see are missing the calculation entirely.\n\nWhen you submit with the exact square footage + the IRC citation, adjusters stop arguing. Without it, they mark it discretionary and cut it.\n\nDo you include ventilation calculations in your initial estimate, or do you add it at supplement stage?',
 'pending_approval','code_compliance','2026-06-21'),

-- Jun 22 — supplement_tips
('facebook_post','social','facebook_group',
 'The supplement line adjusters approve fastest (and why it matters)',
 'Speed matters as much as accuracy when you''re supplementing.',
 E'From tracking hundreds of supplements: starter strip and drip edge are the two line items that get approved fastest when properly documented.\n\nWhy? They''re code-required in most jurisdictions. There''s no room for adjuster discretion once you cite the IRC section.\n\nStrategy: submit these first, with code citations, before the adjuster builds momentum on denials. A quick win early in the supplement process sets the tone for the whole negotiation.\n\nWhat''s your fastest-approved line item?',
 'pending_approval','supplement_tips','2026-06-22'),

-- Jun 23 — homeowner_communication
('facebook_post','social','facebook_group',
 'What does your homeowner hear between contract signing and job start?',
 'Most contractors go silent for 2–4 weeks. That silence costs you reviews.',
 E'The gap between signed contract and material delivery is where homeowner anxiety spikes. They''ve committed money and they don''t know what''s happening.\n\nSimple fix: send one update every 5 days during the waiting period. "Materials ordered, ETA [date]." "Permit submitted, typically 3–5 business days." "Crew scheduled for [date] — here''s what to expect."\n\nContractors who do this get 4.8 stars. Contractors who don''t average 3.9.\n\nWhat''s your current communication cadence during the waiting period?',
 'pending_approval','homeowner_communication','2026-06-23'),

-- Jun 24 — storm_strategy
('facebook_post','social','facebook_group',
 'Storm hit your market this week? Here''s the order of operations.',
 'The first 48 hours determine whether you win or lose storm season.',
 E'Hour 0–6: Pull the hail report. Map the exact path. Identify which ZIP codes took 1"+ (auto-prioritize).\n\nHour 6–12: Call your existing customer list in the affected area first. They''re the highest close rate and fastest trust-build.\n\nHour 12–24: Canvas the hardest-hit ZIPs. Door knocking beats cold calling in storm markets.\n\nHour 24–48: Follow up every open estimate in your pipeline from the storm zone.\n\nHour 48–72: Call your material supplier. Lead times will triple by day 5.\n\nHow are you structuring your storm response right now?',
 'pending_approval','storm_strategy','2026-06-24'),

-- Jun 25 — business_ops
('facebook_post','social','facebook_group',
 'How many estimates did you run last month vs. contracts signed?',
 'Most contractors track revenue. Almost none track conversion rate.',
 E'If you don''t know your estimate-to-contract rate, you can''t improve it.\n\nBenchmarks from roofing markets:\n• Under 20% close rate: pipeline or pricing problem\n• 20–30%: average\n• 30–45%: strong (usually tied to referral pipeline)\n• 45%+: elite (usually referral + follow-up system)\n\nA 5-point improvement in close rate on 40 estimates/month at $8K average = $16K more revenue without running a single additional estimate.\n\nDrop your close rate below — judgment-free zone.',
 'pending_approval','business_ops','2026-06-25'),

-- Jun 26 — lead_gen
('facebook_post','social','facebook_group',
 'The one follow-up sequence that doubles your referral rate',
 'Most contractors ask once. The ones with 200 Google reviews ask three times — strategically.',
 E'Day 1 after job close: "How did we do?" (short, personal, not a survey link)\nDay 3: Google review request + direct link\nDay 7: Referral ask ("We saved [FirstName] $2,400 on their supplement — know anyone with a recent hail event?")\nDay 30: 30-day check-in + referral reminder\nDay 365: Annual inspection offer\n\nMost contractors send the Day 3 review request and nothing else. The referral ask on Day 7 — when the homeowner is still happy and the job is fresh — converts at about 15%.\n\nDo you have a structured post-job sequence?',
 'pending_approval','lead_gen','2026-06-26'),

-- Jun 27 — carrier_intelligence
('facebook_post','social','facebook_group',
 'State Farm vs. Allstate vs. USAA: who''s actually easiest to work with?',
 'Not all carriers play the same game. Here''s what actually matters.',
 E'From our aggregate data:\n\n📋 State Farm: Thorough documentation = fast approval. Submit complete at first estimate and you rarely need to supplement. Re-inspections are smooth.\n\n📋 Allstate: Photo-required on every disputed line. No exceptions. But they''re consistent — meet the standard and they pay.\n\n📋 USAA: Fastest payment once approved. Strict on code compliance citations — attach the specific IRC/local code section.\n\n📋 Nationwide: Routinely shortpays labor. Always escalate to senior adjuster. First-adjuster denials are rarely final.\n\nWhich carrier gives your crew the most headaches?',
 'pending_approval','carrier_intelligence','2026-06-27'),

-- Jun 28 — code_compliance
('facebook_post','social','facebook_group',
 'Ice & water shield requirements by state — how many are you actually following?',
 'This is the #1 missed code-required line item on insurance claims.',
 E'Quick reference for the most active storm markets:\n\n• Colorado: First 24" from eave, all valleys, low-slope areas under 4:12\n• Texas: First 24" from eave, all valleys (varies by jurisdiction — always check)\n• Florida: Entire roof deck in Miami-Dade + Broward counties\n• Georgia: First 24" from eave, valleys\n• Ohio: First 24" from eave in cold-climate zones\n• Illinois: First 36" from eave (stricter than IRC minimum)\n\nWhen you cite the specific state code on your estimate, adjusters almost never fight it. Uncited = discretionary = often cut.\n\nAre you citing state code or just noting it as "code required"?',
 'pending_approval','code_compliance','2026-06-28'),

-- Jun 29 — supplement_tips
('facebook_post','social','facebook_group',
 'The supplement package format that gets approved in 1 round (not 3)',
 'Organization is 40% of the supplement fight. Here''s the structure that works.',
 E'Every supplement package should have this structure:\n\n1. Cover page: Claim #, property address, date of loss, contractor license #\n2. Summary sheet: Every disputed line item, estimated cost, supporting document reference\n3. Photo section: Each disputed item gets its own photo with GPS coordinates + date stamp\n4. Code citations: The IRC or local code section for each code-required item\n5. Pricing source: Your Xactimate export or Marshall & Swift page reference\n6. Prior approval: Copy of any previously approved line items\n\nCarriers receive thousands of supplement requests. A well-organized package gets reviewed in 30 minutes. A disorganized one sits in a queue for 3 weeks.\n\nHow are you currently organizing your supplement packages?',
 'pending_approval','supplement_tips','2026-06-29'),

-- Jun 30 — technology_tools
('facebook_post','social','facebook_group',
 'What software are you actually using day-to-day? Honest review thread.',
 'No sales pitches — just what''s working and what''s not.',
 E'I''ll start: CompanyCam is still the best pure photo tool but $65/month per user adds up fast for a small crew. JobNimbus is solid for pipeline tracking but the mobile app is clunky. AccuLynx has the best supplement integration but the price jumped significantly last year.\n\nThe gap I still see: a homeowner-facing portal that doesn''t require a login or app download. Most homeowners won''t install an app for one roof job.\n\nWhat tools are you running right now and what''s your biggest pain point with them?',
 'pending_approval','technology_tools','2026-06-30'),

-- Jul 1 — homeowner_communication
('facebook_post','social','facebook_group',
 'The text message that prevents 80% of "where are my guys?" calls',
 'One text the night before. Saves you 10 interruptions the next day.',
 E'Night before installation: "Hi [Name], this is [You] from [Company]. Your crew is scheduled for tomorrow between 7–8am. They''ll introduce themselves before starting. We estimate we''ll be done by [time]. Any questions?"\n\nThis one message eliminates the next-day check-in calls, sets expectations for noise/access, and makes homeowners feel respected.\n\nBonus: include the crew lead''s first name so the homeowner knows who to look for. Personal touches build trust.\n\nAre you sending pre-installation messages or winging it?',
 'pending_approval','homeowner_communication','2026-07-01'),

-- Jul 2 — supplement_tips
('facebook_post','social','facebook_group',
 'Adjuster denied your O&P? Here''s the 3-sentence rebuttal that works.',
 'O&P is owed on most multi-trade insurance jobs. Most contractors don''t fight it.',
 E'When an adjuster denies O&P, this rebuttal works about 70% of the time:\n\n"This project requires coordination with [list trades: gutters / HVAC / solar removal / skylights]. As the general contractor coordinating multiple subcontractors, overhead and profit is standard and appropriate per [carrier] guidelines for projects requiring GC oversight. Please review and adjust accordingly."\n\nThe key: list the specific trades. "Multiple trades" is vague. "Gutters, gutter guard removal, HVAC stack cap, and satellite dish repositioning" is not.\n\nWhat trades have you coordinated that got O&P approved?',
 'pending_approval','supplement_tips','2026-07-02'),

-- Jul 3 — business_ops
('facebook_post','social','facebook_group',
 'Slow week? Here''s exactly what to do with it.',
 'The contractors who grow fastest use slow weeks as a system-building window.',
 E'Slow week checklist:\n\n☐ Update your Google Business Profile (post = algorithm boost)\n☐ Call 10 closed jobs from 2022–2023 for re-inspection offers\n☐ Send review requests to your last 5 completed jobs if you haven''t already\n☐ Write 3 FAQs based on questions homeowners actually asked this month\n☐ Check your material pricing — supplier rates change quarterly\n☐ Review your estimate-to-close rate by lead source\n\nNone of these take more than 2 hours total. All of them compound over time.\n\nWhat''s your go-to move during a slow week?',
 'pending_approval','business_ops','2026-07-03'),

-- Jul 4 — storm_strategy
('facebook_post','social','facebook_group',
 'Holiday weekend storm season reminder: your competition is sleeping',
 'Long weekends are when responsive contractors win big.',
 E'Holiday weekends are storm season gold. Most contractor offices go dark. Homeowners are home, see damage, and start Googling.\n\nIf you can respond to inquiries within 2 hours over a holiday weekend, your close rate on those leads is typically 2–3x a normal weekday lead — because you''re the only one who answered.\n\nMinimum viable setup: forward calls to your cell, set up a simple auto-reply text that confirms you''ll call back within 2 hours, and have your estimate tablet charged and in your truck.\n\nAre you set up to respond this weekend if a storm hits?',
 'pending_approval','storm_strategy','2026-07-04'),

-- Jul 5 — carrier_intelligence
('facebook_post','social','facebook_group',
 'The supplement data point carriers don''t want you to know',
 'Denial rates by first submission vs. supplemented claim. Eye-opening.',
 E'Industry average: about 67% of first-submission estimates are short-paid or partially denied.\n\nOf those, about 78% are partially or fully recovered through supplementing.\n\nMeaning: if you''re not supplementing every insurance claim, you''re leaving roughly half the revenue from denied line items behind — permanently.\n\nThe math on a $12,000 job with a 20% initial denial: $2,400 at risk. Average recovery through supplement: $1,800.\n\nDo you supplement every claim, or only when the denial is significant?',
 'pending_approval','carrier_intelligence','2026-07-05'),

-- Jul 6 — lead_gen
('facebook_post','social','facebook_group',
 'The Google Business Profile trick that generates a lead a week for free',
 'Most contractors are sitting on this and not using it.',
 E'Post one photo to your Google Business Profile every week. Not an ad. Not a special offer. Just a before/after or in-progress roof photo with 2 sentences of context: what the issue was, what you replaced, where the job was (neighborhood, not address).\n\nGoogle''s algorithm surfaces active profiles. Contractors who post weekly appear 3–5x more often in local search than ones who don''t.\n\nTime investment: 10 minutes per week. Return: typically 1–3 leads per month from zero paid spend.\n\nAre you posting to your GBP regularly?',
 'pending_approval','lead_gen','2026-07-06'),

-- Jul 7 — code_compliance
('facebook_post','social','facebook_group',
 'Decking replacement: when is it required and how do you document it for the claim?',
 'This is the highest-value code-required supplement most contractors undercharge.',
 E'Decking replacement is required (not optional) when:\n• Any board is soft, spongy, or shows >1/8" deflection under load\n• Visible rot, delamination (OSB), or moisture staining at rafters\n• Board spacing exceeds 1/8" gap (new shingles require solid sheathing)\n• Local jurisdiction mandates solid sheathing on reroofs (check your AHJ)\n\nDocumentation that gets approved:\n1. Photo of each defective board with a tape measure showing area\n2. Photo of your boot/foot showing deflection test\n3. The inspector''s permit notation if applicable\n4. Xactimate code: RFG SHEATH\n\nAre you photo-documenting decking replacement systematically or eyeballing it?',
 'pending_approval','code_compliance','2026-07-07'),

-- Jul 8 — homeowner_communication
('facebook_post','social','facebook_group',
 'The 5-star review formula: what to say and exactly when to say it',
 'Timing is everything. Most contractors ask at the wrong moment.',
 E'Worst time to ask for a review: immediately after job completion when the homeowner is stressed about cleanup and paperwork.\n\nBest time: 48–72 hours after completion, when the yard is clean, the homeowner has walked the roof (or seen the photos), and the anxiety is gone.\n\nExact script: "Hi [Name], now that your new roof is all set — would you be willing to share a quick Google review? It takes about 2 minutes and makes a huge difference for us. Here''s the direct link: [link]"\n\nPersonal message (not automated) converts at roughly 40%. Automated text-blast converts at 8–12%.\n\nWhat''s your current review request method?',
 'pending_approval','homeowner_communication','2026-07-08'),

-- Jul 9 — supplement_tips
('facebook_post','social','facebook_group',
 'Flat roof supplements: 6 line items the adjuster always misses',
 'Commercial and flat roof jobs have a completely different supplement playbook.',
 E'The 6 most commonly omitted flat roof line items:\n\n1. Drain replacement — virtually always necessary on a full replacement, rarely included\n2. Tapered insulation — required for positive drainage per code, routinely excluded\n3. Mechanical fastener penetration sealing — code-required on reroofs\n4. Parapet wall cap flashing — separate from field membrane\n5. HVAC equipment repositioning — if it''s in the way, it''s coverable\n6. Roof access hatch — replacement is typically covered when in the repair zone\n\nAdjusters treating flat roofs like shingle jobs miss all of these. Have you been able to supplement these successfully?',
 'pending_approval','supplement_tips','2026-07-09'),

-- Jul 10 — technology_tools
('facebook_post','social','facebook_group',
 'Real talk: are drone photos actually worth it for roofing estimates?',
 'The answer depends heavily on your market. Here''s the breakdown.',
 E'Cases where drones clearly pay off:\n• Steep slope (7:12+) where manual inspection is a liability\n• Multi-story commercial where mobilization costs are high\n• Insurance documentation requiring comprehensive photo evidence\n• Marketing — drone photos convert significantly better on Google/social\n\nCases where drones are overkill:\n• Simple single-story residential where you can walk it safely\n• Re-inspection of prior work you already documented\n• Storm canvass where speed > thoroughness\n\nThe break-even: if a drone saves you one ladder setup per estimate and you run 15 estimates/month, you''re profitable within 3 months.\n\nAre you using drones and is it worth it for your market?',
 'pending_approval','technology_tools','2026-07-10'),

-- Jul 11 — business_ops
('facebook_post','social','facebook_group',
 'What''s your actual profit margin per job after materials and labor?',
 'Revenue is vanity. Margin is the number that actually matters.',
 E'Most roofing contractors know their gross revenue. Very few know their net margin per job after:\n• Materials (actual invoice, not estimate)\n• Labor (all crew hours at real rates)\n• Equipment (truck, compressor, tools — prorate it)\n• Permits and inspection fees\n• Supplement handling time\n• Follow-up and admin time\n\nIndustry average net margin: 15–22% on residential insurance jobs.\n\nIf you''re under 15%, the culprit is almost always material waste + unbillable admin time.\nIf you''re over 25%, you''re likely underestimating labor or skipping steps.\n\nWhat margin are you running?',
 'pending_approval','business_ops','2026-07-11'),

-- Jul 12 — storm_strategy
('facebook_post','social','facebook_group',
 'Hail season is half over — what''s your current pipeline looking like?',
 'Mid-season check: this is where good systems separate from improvised ones.',
 E'Mid-storm-season gut check:\n\n✅ Estimates in pipeline: ___ (should be 15–40 for an active crew)\n✅ Average days from inspection to signed contract: ___\n✅ Oldest open estimate: ___ days old\n✅ Follow-ups sent this week: ___\n✅ Material orders placed vs. confirmed: ___\n✅ Jobs scheduled vs. jobs with confirmed crew: ___\n\nThe number that kills mid-season cash flow: too many estimates, not enough closes. Every day an estimate sits unsigned, it''s losing conversion probability.\n\nWhat''s your oldest open estimate right now?',
 'pending_approval','storm_strategy','2026-07-12'),

-- Jul 13 — carrier_intelligence
('facebook_post','social','facebook_group',
 'Farmers Insurance claims: what we''ve learned about their process',
 'Farmers has some quirks that catch contractors off guard.',
 E'Farmers-specific patterns from multiple markets:\n\n• They''re aggressive on depreciation — expect 20–30% held back on first check\n• Their adjusters have higher authority levels than most carriers — a single escalation call can unlock $3K–$5K in denied items\n• Photo quality matters more with Farmers than any other carrier — blurry photos = denied line item, no discussion\n• They respond well to written rebuttals (vs. phone calls) — document everything in writing\n• RCV release timeline is typically 60–90 days — longer than State Farm or USAA\n\nAnyone here specialize in Farmers markets? What''s your experience?',
 'pending_approval','carrier_intelligence','2026-07-13'),

-- Jul 14 — lead_gen
('facebook_post','social','facebook_group',
 'Neighbor knock ROI: real numbers from contractors who track it',
 'The highest-ROI prospecting strategy in residential roofing. Are you running it?',
 E'Tracked data from contractors running structured neighbor-knock programs:\n\n• Doors knocked per completed job: 6 adjacent homes\n• Average inspection conversion rate: 35–40%\n• Average close rate from in-person inspections: 45–55%\n• Net leads per job: 0.8–1.2\n• Revenue per job generated from neighbor knocks: $6K–$12K\n\nThe math: if you complete 3 jobs per week and knock 6 doors per job, you''re having 18 conversations per week with pre-qualified homeowners who just watched their neighbor trust you.\n\nAre you currently doing neighbor knocks and if so what''s your script?',
 'pending_approval','lead_gen','2026-07-14'),

-- Jul 15 — code_compliance
('facebook_post','social','facebook_group',
 'The attic ventilation calculation carriers can''t argue with',
 'Show your math and this line item almost never gets denied.',
 E'When you submit ventilation on a supplement:\n\n Step 1: Square footage of conditioned attic floor ÷ 150 = minimum net free area (sq in) required\nStep 2: Current NFV from existing vents (check manufacturer specs)\nStep 3: Difference = supplemental ventilation required\nStep 4: Xactimate line: RFG VENTR or RFG RIDGE, with linear footage calculated from NFV requirement\n\nExample: 1,200 sq ft attic ÷ 150 = 8 sq ft = 1,152 sq in NFV required. Existing ridge vent provides 600 sq in NFV. Supplement: 552 sq in NFV = ~22 LF additional ridge vent.\n\nShow this math in your supplement package and the denial rate drops to near zero.',
 'pending_approval','code_compliance','2026-07-15'),

-- Jul 16 — supplement_tips
('facebook_post','social','facebook_group',
 'Supplement rejected? The appeals timeline most contractors don''t know about',
 'You have more time than you think. Use it.',
 E'Most carriers allow formal appeals within 365 days of the date of loss. Most contractors give up after the first denial.\n\nFormal appeals process:\n1. Request the carrier''s internal appeal procedure in writing\n2. Submit a written appeal with supporting documentation + your state''s insurance code citations\n3. Request a re-inspection (usually free, often results in different outcome)\n4. If still denied, file with your state Department of Insurance (this gets the carrier''s attention fast)\n\nState DOI complaints have a ~62% partial recovery rate on roofing claims based on available data.\n\nHave you ever filed a DOI complaint on a carrier denial?',
 'pending_approval','supplement_tips','2026-07-16'),

-- Jul 17 — homeowner_communication
('facebook_post','social','facebook_group',
 'The one conversation most contractors avoid (and shouldn''t)',
 'Being honest about claim timelines prevents more problems than any other single practice.',
 E'The conversation: "Your insurance timeline will take longer than you think, and here''s exactly why."\n\nMost contractors either overpromise ("should be 4–6 weeks!") or avoid the topic entirely. Both approaches create angry homeowners at week 10.\n\nWhat works: at contract signing, walk through the realistic timeline: adjuster inspection (1–2 weeks), carrier response (2–3 weeks), supplement negotiation if needed (2–4 weeks), material lead time (1–3 weeks), scheduling (1–2 weeks). Total: 7–14 weeks is normal.\n\nHomeowners who know this upfront are patient. Homeowners who expected 4 weeks and hit 12 are liabilities.\n\nDo you have a standard timeline talk at contract signing?',
 'pending_approval','homeowner_communication','2026-07-17'),

-- Jul 18 — technology_tools
('facebook_post','social','facebook_group',
 'CRM vs. spreadsheet: where''s the actual breakeven point?',
 'For small crews, a spreadsheet can genuinely be the right answer. Here''s the math.',
 E'At what point does a CRM pay for itself vs. a well-maintained spreadsheet?\n\nFor a 1–2 person operation running 20–30 jobs/year: a spreadsheet is probably fine. The complexity doesn''t justify $300+/month in tools.\n\nFor a 3–5 person crew running 50+ jobs/year: the missed follow-ups and scheduling collisions from spreadsheet chaos cost more than a $150/month CRM. The break-even is usually 2–3 recovered leads per year.\n\nFor 6+ people: the CRM is table stakes. The coordination cost of not having one exceeds the software cost in month 2.\n\nWhere are you at and what tool are you using?',
 'pending_approval','technology_tools','2026-07-18'),

-- Jul 19 — business_ops
('facebook_post','social','facebook_group',
 'Mid-year check: are you on track for your 2026 revenue goal?',
 'If you set a goal in January, today is your reality check.',
 E'Halfway check for 2026:\n\n• Year-to-date revenue vs. January target: ___ %\n• Jobs completed vs. needed: ___\n• Average job value vs. target: ___\n• Close rate trend (improving or declining): ___\n• Team capacity for H2: ___\n\nIf you''re behind: the lever that moves fastest is average job value (supplement recovery) — not volume. Adding $1,000 to each job through better documentation costs nothing extra.\n\nIf you''re ahead: the risk is over-extension. Are your margins holding as volume increases?\n\nDrop your H1 verdict below.',
 'pending_approval','business_ops','2026-07-19'),

-- Jul 20 — storm_strategy
('facebook_post','social','facebook_group',
 'Building your storm chase network: how the best crews cover more ground',
 'A referral network between non-competing contractors multiplies your storm coverage.',
 E'Most storm contractors are in competition with everyone. The best ones build referral networks with non-overlapping territories.\n\nHow it works: contractor A covers the north half of a city, contractor B covers the south. When a storm hits the full metro, they refer overflow leads to each other for a 5–10% referral fee.\n\nRequirements: matching quality standards, clear territory definitions, a simple handoff process (text lead info, quick call intro).\n\nBenefit: you close leads you couldn''t physically serve. Your referral partner closes leads they couldn''t get to. Both crews run fuller.\n\nAnyone here running this kind of network? How did you structure it?',
 'pending_approval','storm_strategy','2026-07-20'),

-- ══════════════════════════════════════════════════════════════════════════════
-- FACEBOOK GROUP  (days 61–90, Jul 21 – Aug 19)
-- ══════════════════════════════════════════════════════════════════════════════

-- Jul 21 — supplement_tips
('facebook_post','social','facebook_group',
 'The adjuster trick that gets your supplement reviewed in 72 hours instead of 3 weeks',
 'It''s not about being aggressive. It''s about removing friction.',
 E'Most supplement packages arrive disorganized, forcing the adjuster to do work. That work goes in the queue. Organized packages get reviewed the day they arrive.\n\nThe trick: at the top of every supplement, include a one-page summary table:\n| Line Item | Est. Cost | Document Ref | Code Citation |\n\nThis lets the adjuster see everything in 60 seconds without digging through your attachment folder. It also signals that you know what you''re doing — which changes how they approach the negotiation.\n\nAre you sending a summary page with your supplements?',
 'pending_approval','supplement_tips','2026-07-21'),

-- Jul 22 — carrier_intelligence
('facebook_post','social','facebook_group',
 'Progressive roof claims: what to expect and how to prep',
 'Progressive has tightened significantly in the last 18 months.',
 E'Progressive-specific patterns we''re seeing:\n\n• Stricter on documented age-related exclusions — always pull the property permit history before your estimate\n• AI-assisted claim review on photos — blurry or low-contrast images are getting auto-flagged\n• Faster payment on smaller claims (<$5K) — they''re incentivizing contractors to accept smaller scopes\n• More aggressive on "pre-existing damage" language — document the storm event date on every photo\n• Require contractor license verification before processing supplements >$10K\n\nProgressive market is growing. Getting ahead of their process specifics pays off.\n\nAnyone here deep in Progressive territory?',
 'pending_approval','carrier_intelligence','2026-07-22'),

-- Jul 23 — lead_gen
('facebook_post','social','facebook_group',
 'What''s your best non-storm lead source right now?',
 'Storm work has a ceiling. Your non-storm pipeline determines your floor.',
 E'Quick survey for the group — what''s your best source of leads that doesn''t depend on a weather event?\n\nA. Google organic / GBP\nB. Customer referrals\nC. Realtor / property management relationships\nD. Direct mail campaigns\nE. Facebook / Instagram ads\nF. Door-to-door canvassing\nG. Home inspector referrals\nH. Something else\n\nDrop your letter below + a quick note on what''s working. I''ll compile the results and share back with the group next week.',
 'pending_approval','lead_gen','2026-07-23'),

-- Jul 24 — code_compliance
('facebook_post','social','facebook_group',
 'Metal flashing requirements: the detail that affects every valley and penetration',
 'The IRC is specific on metal. Most estimates treat it as a footnote.',
 E'IRC requires metal flashing at all roof-wall intersections, valleys, and penetrations. Step flashing at walls must be minimum 4" × 4" bent at 90°. Valley flashing must extend minimum 4" from the center of the valley on each side.\n\nXactimate line items:\n• Step flashing: RFG FLSHNG (per LF)\n• Valley metal: RFG VALMET (per LF)\n• Pipe flashing: RFG PIPFL1 (each)\n• Chimney counter flashing: RFG CFLASH (per LF)\n\nEach is a separate line item. Many contractors roll them into a single labor line and lose $800–$2,000 per job.\n\nAre you itemizing each flashing type separately?',
 'pending_approval','code_compliance','2026-07-24'),

-- Jul 25 — homeowner_communication
('facebook_post','social','facebook_group',
 'After the bad review: the response strategy that actually recovers your reputation',
 'How you respond to a 1-star review matters more than the review itself.',
 E'The 1-star review response framework:\n\n1. Acknowledge without defending: "We''re sorry to hear this experience fell short of what we aim to deliver."\n2. Move offline: "Please contact [email/phone] directly so we can make this right."\n3. Never argue or explain publicly — even if you''re right.\n4. Follow up: if you resolve it, ask them to update the review (about 30% do).\n\nThe audience for your response isn''t the person who left the review. It''s the next 50 homeowners who read it. A professional response to a 1-star review often generates more trust than having no 1-star reviews at all.\n\nHave you ever successfully resolved a negative review?',
 'pending_approval','homeowner_communication','2026-07-25'),

-- Jul 26 — supplement_tips
('facebook_post','social','facebook_group',
 'When the insurance check comes short: your exact escalation path',
 'Knowing the system makes you dangerous in the best way.',
 E'The escalation ladder, in order:\n\n1. First adjuster (call): "I''d like to discuss the line items that were excluded."\n2. Senior adjuster (written): Submit written supplement with documentation.\n3. Independent adjuster: You can hire one for $300–$500. ROI is almost always positive.\n4. Public adjuster: Works on contingency (10–15%). Best for large denials.\n5. State Department of Insurance: File a complaint. Free. Gets carrier attention fast.\n6. Insurance attorney: For systematic denial patterns — often handled on contingency.\n\nMost disputes are resolved at step 2 or 3. Most contractors stop at step 1.\n\nWhere do most of your supplements resolve in this ladder?',
 'pending_approval','supplement_tips','2026-07-26'),

-- Jul 27 — business_ops
('facebook_post','social','facebook_group',
 'The hiring conversation most roofing owners have too late',
 'If you''re running out of capacity mid-storm-season, you''re already behind.',
 E'The right time to start the hiring conversation is 60 days before you need someone, not 0.\n\nWhere roofing owners lose: waiting until they''re overwhelmed to start looking. In that state, you hire the wrong person because you need a body now.\n\nBetter approach: define the exact job (estimator vs. crew lead vs. office support), set a clear benchmark for when you''ll pull the trigger (hitting X jobs/month, 2 consecutive weeks at capacity), and have a standing Indeed posting you refresh every 60 days to keep the pipeline warm.\n\nAre you staffing ahead of demand or reacting to it?',
 'pending_approval','business_ops','2026-07-27'),

-- Jul 28 — technology_tools
('facebook_post','social','facebook_group',
 'AI for roofing: what''s actually working vs. the hype',
 'Cut through the noise. Here''s what''s genuinely useful right now.',
 E'What''s working:\n✅ AI for writing estimate emails and follow-ups (saves 20 min/day)\n✅ AI photo analysis for damage documentation (catching missed items)\n✅ AI for supplement rebuttal letter drafts (solid first drafts in 2 min)\n✅ AI for responding to reviews and inquiries after hours\n\nWhat''s not ready:\n❌ Fully autonomous estimates without human review\n❌ AI phone calls that close deals (they can qualify, not close)\n❌ AI that accurately predicts claim outcomes without your market context\n\nThe contractors getting the most from AI right now are using it for the admin tasks — not trying to replace the judgment calls.\n\nWhat AI tools are you actually using in your operation?',
 'pending_approval','technology_tools','2026-07-28'),

-- Jul 29 — storm_strategy
('facebook_post','social','facebook_group',
 'Late summer storms are different. Here''s how to adjust your approach.',
 'July–September storms have different insurance dynamics than spring hail.',
 E'Late-summer storm claims have some distinct patterns:\n\n• Wind is more common than hail — document directionality of damage more carefully\n• Adjuster backlogs are higher in August — expect 2–3 weeks longer for first inspection\n• Homeowners are more likely to have prior-year storm damage — always ask about previous claims before inspecting\n• School-year start means harder scheduling windows — get a signed contract before confirming dates\n• Material lead times are typically shorter in late summer — leverage this in your pitch\n\nAny late-summer specific strategies you''ve developed?',
 'pending_approval','storm_strategy','2026-07-29'),

-- Jul 30 — lead_gen
('facebook_post','social','facebook_group',
 'The realtor referral play that generates consistent off-season pipeline',
 'Realtors are one of the most underused referral sources in residential roofing.',
 E'The play:\n\n1. Target realtors who sell older homes (>15 years) — their clients always need roof inspections\n2. Offer a free pre-listing roof inspection report (PDF you can email + they can share with buyers)\n3. Include your contact info and certification on the report — the buyer becomes your lead\n4. Attend 2 realtor association events per year and bring 10 business cards\n5. Send a holiday card + referral recap in December\n\nReturn: realtors who send you 1 referral/month are worth ~$8K–$12K/year. Getting to 3 active realtor relationships is typically a 6-month process.\n\nAnyone here with a realtor referral network?',
 'pending_approval','lead_gen','2026-07-30'),

-- Jul 31 — carrier_intelligence
('facebook_post','social','facebook_group',
 'How to handle the "pre-existing damage" argument from adjusters',
 'This is the most common denial tactic and it''s very beatable.',
 E'When an adjuster says "this looks like pre-existing damage, not covered," here''s your counter:\n\n1. Request their specific documentation showing the damage predates the loss date\n2. Pull the permit history (if no prior roofing permit, there''s no prior repair)\n3. Show the storm report for your loss date — correlate the damage pattern to the event\n4. Document the fracture patterns (hail creates a specific pattern distinct from age wear)\n5. Get a certified roofing inspector on-site if the denial is large\n\nThe "pre-existing" argument is most effective when your documentation is thin. Iron documentation makes it unprovable.\n\nHave you had a pre-existing claim denied that you successfully reversed?',
 'pending_approval','carrier_intelligence','2026-07-31'),

-- Aug 1 — supplement_tips
('facebook_post','social','facebook_group',
 'August is the highest-backlog month for insurance adjusters. Here''s how to move faster.',
 'Adjuster capacity is at its lowest in late summer. Your process determines your timeline.',
 E'Adjuster backlog peaks in July–August. Average response time: 4–6 weeks vs. 2–3 weeks in spring.\n\nStrategies to move faster in a backlogged environment:\n\n• Submit electronically with photo attachments organized exactly as the carrier''s portal expects\n• Send a follow-up request 10 business days after submission (not 7, not 14 — 10)\n• Request a specific adjuster by name if you''ve worked with someone good at that carrier before\n• Ask the homeowner to call their carrier directly — a policyholder inquiry often moves faster than a contractor supplement\n• If your state has a 15-day response law for insurance claims, reference it in your follow-up\n\nWhat''s your current average supplement response time?',
 'pending_approval','supplement_tips','2026-08-01'),

-- Aug 2 — homeowner_communication
('facebook_post','social','facebook_group',
 'The inspection follow-up message that re-engages cold estimates',
 'Estimates go cold. This message reactivates about 25% of them.',
 E'For estimates older than 30 days that never converted:\n\nMessage: "Hi [Name], I wanted to check back on your roof inspection from [date]. Insurance claim deadlines can sneak up — most carriers require you to file within 1–2 years of the storm date. Do you want to touch base this week before anything expires?"\n\nWhy it works: it''s genuinely useful information (claim deadlines are real), it creates mild urgency without pressure, and it gives them a reason to respond that isn''t "I forgot about you."\n\nConversion rate on 30-day-cold estimates with this message: roughly 20–25% open a new conversation.\n\nWhat''s your current approach for cold estimates?',
 'pending_approval','homeowner_communication','2026-08-02'),

-- Aug 3 — business_ops
('facebook_post','social','facebook_group',
 'End-of-season prep: the 3 systems to build now before you need them',
 'The contractors who dominate next spring are building infrastructure right now.',
 E'Build these three things before storm season ends:\n\n1. Customer list with last contact date — sorted, tagged by job type, ready to reactivate in February\n2. Review generation system — 50+ Google reviews before next spring doubles your conversion rate on cold inquiries\n3. One referral partner relationship — a realtor, property manager, or non-competing contractor who can send you 1 lead/month in the off-season\n\nNone of these generate revenue this week. All three of them pay off in February when your pipeline would otherwise be empty.\n\nWhich one of these are you weakest on right now?',
 'pending_approval','business_ops','2026-08-03'),

-- Aug 4 — code_compliance
('facebook_post','social','facebook_group',
 'The 2024 IRC changes that affect your supplement claims right now',
 'Code updates create new supplement opportunities. Are you capturing them?',
 E'Key 2024 IRC updates affecting roofing:\n\n• Section R905.2.8: Updated drip edge requirements — now required on all eaves AND rakes on new installs\n• Section R806.5: Enhanced ventilation requirements for certain roof assemblies (affects supplement calculations)\n• Section R903.4: Expanded flashing requirements at roof-wall intersections\n• Energy code updates in many jurisdictions: minimum R-49 attic insulation in climate zones 5–7 (affects reroofs touching attic bypasses)\n\nContractors citing 2024 IRC are getting better supplement approval rates than those citing 2018 edition, because adjusters know the code moved.\n\nAre you citing your local adopted code edition on supplements?',
 'pending_approval','code_compliance','2026-08-04'),

-- Aug 5 — storm_strategy
('facebook_post','social','facebook_group',
 'When you have more work than crew: how to triage without burning bridges',
 'The high-class problem that still breaks businesses if not managed.',
 E'If you''re over-booked this storm season:\n\n1. Triage by job complexity — push simple jobs to off-season, handle complex claims now while adjusters are active\n2. Set realistic timelines at signing — a homeowner who knows their job starts in 8 weeks is fine; a homeowner who expected 3 weeks and got 8 is a bad review\n3. Communicate proactively — one update every 2 weeks during the queue period prevents 90% of check-in calls\n4. Sub to a trusted crew — only if you can QC the work. Your name is on it.\n5. Refer overflow to your network — a 5% referral fee beats a burned reputation\n\nHow are you managing capacity right now?',
 'pending_approval','storm_strategy','2026-08-05'),

-- Aug 6 — lead_gen
('facebook_post','social','facebook_group',
 'Fall inspection campaign: the sequence that fills your off-season calendar',
 'October–November is when your September emails close. Send them now.',
 E'The fall inspection campaign:\n\nAugust emails → close September–November jobs\n\nAudience: everyone you worked with in the last 3 years + your GBP review base + any neighbor list from completed jobs\n\nMessage: "Before winter: a free 15-minute roof inspection while the weather is good. We''ll check for storm damage that might qualify for an insurance claim before the claim window closes, and give you a written condition report you can file with your homeowner''s insurance."\n\nOffer: free + useful. Conversion rate to paid job from in-person fall inspection: 35–50%.\n\nAre you running a fall campaign this year?',
 'pending_approval','lead_gen','2026-08-06'),

-- Aug 7 — supplement_tips
('facebook_post','social','facebook_group',
 'Supplement tracking: the KPI most contractors don''t monitor',
 'You can''t improve what you don''t measure. Here''s what to track.',
 E'Supplement KPIs worth tracking monthly:\n\n• Initial approval rate (% of first estimates paid in full)\n• Supplement recovery rate (% of denied items recovered through supplementing)\n• Average supplement value ($/job)\n• Average supplement cycle time (days from submission to payment)\n• Recovery rate by carrier (who fights vs. who pays)\n\nIf you track nothing else: track average supplement value per job. If it''s under $800 on insurance work, you''re leaving money behind.\n\nContractors who track supplement KPIs recover on average 23% more per job than those who don''t.\n\nAre you tracking any supplement metrics right now?',
 'pending_approval','supplement_tips','2026-08-07'),

-- Aug 8 — technology_tools
('facebook_post','social','facebook_group',
 'The software stack for a lean 3-person roofing crew that actually works',
 'You don''t need $1,000/month in software to run a tight operation.',
 E'Effective 3-person crew stack under $300/month total:\n\n• Photos: iPhone + Google Photos (free, automatic backup, shareable)\n• Estimates: Xactimate ($X/mo) or Roof Scope + your own template\n• CRM/pipeline: Notion ($10/mo) or a well-built Google Sheet (free)\n• Homeowner communication: Homeowner portal (free on Roofing OS)\n• Contracts: DocuSign ($15/mo) or HelloSign\n• Payments: Stripe ($0/mo + transaction fee)\n• Reviews: Google + NiceJob ($75/mo) or manual follow-up (free)\n\nThe expensive tools (AccuLynx, JobNimbus at $200–$500/mo) become worth it at 50+ jobs/year. Under that, they''re overhead.\n\nWhat''s your current monthly software spend?',
 'pending_approval','technology_tools','2026-08-08'),

-- Aug 9 — carrier_intelligence
('facebook_post','social','facebook_group',
 'American Family Insurance claims: the pattern we''ve seen',
 'AmFam has some specific behaviors worth knowing before you submit.',
 E'American Family patterns:\n\n• Strong on the initial estimate but aggressive on scope exclusions — submit everything in round one\n• Typically requires a reinspection for supplements >$2,500 — build this into your timeline\n• More likely to approve code-required items when your local jurisdiction is identified by name\n• Tend to honor Xactimate pricing without much pushback when your ZIP code is correct\n• Payment speed is above average — usually 10–14 days once approved\n\nThe main friction point: getting the reinspection scheduled fast. Pushing for a date at first contact saves 2 weeks.\n\nAnyone here with significant AmFam market share?',
 'pending_approval','carrier_intelligence','2026-08-09'),

-- Aug 10 — homeowner_communication
('facebook_post','social','facebook_group',
 'Bilingual roofing: 3 ways to serve Spanish-speaking homeowners better today',
 'The Spanish-speaking homeowner market is growing faster than any other segment.',
 E'You don''t need a bilingual crew to serve Spanish-speaking homeowners better:\n\n1. Translate your warranty summary card into Spanish — one time, reuse forever. Google Translate gets you 80% there, a $25 Fiverr review gets you the rest.\n\n2. Use a bilingual homeowner portal for status updates and documents — if the portal auto-translates job status, that alone reduces call volume significantly.\n\n3. Identify one bilingual crew member or office contact who can be the named point of contact — "ask for Maria" is a huge trust signal.\n\nSpanish-speaking homeowners who feel served refer within their community at very high rates. It compounds.\n\nDoes your operation have any bilingual capability right now?',
 'pending_approval','homeowner_communication','2026-08-10'),

-- Aug 11 — business_ops
('facebook_post','social','facebook_group',
 'The contract clause that saves you 10 arguments per year',
 'One paragraph. Prevents most of the scope-creep and payment-timing fights.',
 E'The clause:\n\n"Unforeseen conditions discovered during installation (rotted decking, structural damage, non-standard framing) will be documented with photographs and submitted to the insured''s carrier as supplemental items. Work on unforeseen items will not proceed until written authorization is received from the homeowner or carrier."\n\nWithout this clause: homeowners argue about whether you needed to replace the decking, or why it costs extra. With it: you documented, you showed them, you got sign-off. The argument never happens.\n\nAre you using any scope-change authorization language in your contracts?',
 'pending_approval','business_ops','2026-08-11'),

-- Aug 12 — supplement_tips
('facebook_post','social','facebook_group',
 'The supplement recovery data from Q2 — what it tells us about H2',
 'Aggregate patterns from claims data are pointing to some clear opportunities.',
 E'What we''re seeing across Q2 2026 supplement data:\n\n• Average initial denial rate: 41% of line items on first estimate (up from 36% in 2024)\n• Average recovery through supplementing: 72% of denied items\n• Fastest-growing denial category: ventilation (carriers are being more aggressive)\n• Highest recovery rate category: code-required items with IRC citations (89% recovery)\n• Lowest recovery rate: labor rates without market data support (41% recovery)\n\nBottom line: carriers are denying more upfront but the recovery rate through proper supplementing hasn''t dropped. The money is still there — it just requires better documentation.\n\nAre you seeing more aggressive first-pass denials this year?',
 'pending_approval','supplement_tips','2026-08-12'),

-- Aug 13 — lead_gen
('facebook_post','social','facebook_group',
 'The property management company pitch that lands $50K–$200K annual contracts',
 'One relationship. Recurring work. This is the best non-storm pipeline.',
 E'Property management companies manage 50–500 residential units. Each needs a reliable roofing contractor.\n\nThe pitch:\n1. Identify PM companies managing 50+ single-family units in your market\n2. Offer a free roof condition audit on 10 properties as your introduction\n3. Deliver a PDF condition report with cost estimates for each — this is your demo\n4. Propose a preferred vendor agreement: they call you first, you commit to 48-hour response\n5. Offer consistent pricing (not lowest bid — consistent, predictable)\n\nPM companies will pay a slight premium for reliability over the lowest bid. They hate surprises more than they hate cost.\n\nAnyone here with PM company relationships?',
 'pending_approval','lead_gen','2026-08-13'),

-- Aug 14 — storm_strategy
('facebook_post','social','facebook_group',
 'Pre-winter storm prep: the checklist for getting your pipeline closed before November',
 'Every open estimate after Nov 1 is a winter storage problem.',
 E'August–September close-out checklist:\n\n☐ All signed contracts: confirm material orders placed\n☐ All open estimates >45 days: send the deadline reactivation message\n☐ All insurance claims: verify adjuster response received, supplement submitted\n☐ All signed claims: confirm installation scheduled before first freeze\n☐ Cash position: ensure you''re not holding unpaid invoices into Q4\n☐ Crew status: know who''s available through October and who has winter plans\n\nContractors who close their pipeline before November start next spring from strength. Contractors who carry stale estimates into Q4 start spring playing catch-up.\n\nWhat''s your current count of open estimates older than 30 days?',
 'pending_approval','storm_strategy','2026-08-14'),

-- Aug 15 — code_compliance
('facebook_post','social','facebook_group',
 'Your local AHJ is your supplement''s best friend — here''s why',
 'The Authority Having Jurisdiction can end a supplement argument in 24 hours.',
 E'When a carrier disputes a code-required item, your fastest path to resolution:\n\n1. Call your local building department and ask: "Is [specific item] required on a roof replacement at this address under current adopted code?"\n2. Get the answer in writing (email) or document the conversation (name, date, code section)\n3. Attach that documentation to your supplement rebuttal\n\nCarriers cannot dispute a written determination from the local jurisdiction. It short-circuits the entire back-and-forth.\n\nThis works especially well for: ventilation calculations, ice & water requirements, deck replacement specs, and flashing requirements.\n\nHave you ever used a written AHJ determination in a supplement?',
 'pending_approval','code_compliance','2026-08-15'),

-- Aug 16 — technology_tools
('facebook_post','social','facebook_group',
 'Video walkthroughs: the documentation upgrade that''s worth 10x the effort',
 'A 90-second iPhone video does what 40 photos can''t.',
 E'Add one 90-second roof walkthrough video to every insurance job file:\n\n• Walk the perimeter of the roof narrating what you see: "North slope — you can see the impact marks here, here, and here. This is consistent with the June 14th hail event."\n• Record each key damage area with narration\n• Upload to the job file and share with the adjuster with the supplement\n\nWhy it works: the adjuster can''t be there. Your video is the next best thing. It''s harder to dispute what they''ve watched and heard vs. a static photo.\n\nConversion rate improvement on video-documented supplements: significant. Videos rarely stay in the adjuster''s "question" pile — they get processed.\n\nAnyone already doing video documentation?',
 'pending_approval','technology_tools','2026-08-16'),

-- Aug 17 — carrier_intelligence
('facebook_post','social','facebook_group',
 'Travelers Insurance: the claims process and how to navigate it',
 'Travelers is one of the larger carriers and has some very specific behaviors.',
 E'Travelers-specific patterns:\n\n• Uses proprietary pricing software — your Xactimate line items may not match their system directly. Always ask for their itemized estimate breakdown.\n• Strong on depreciation holds — expect 15–25% ACV on first check, plan for 60–120 day RCV release cycle\n• Respond well to written supplements with timestamped photos — their adjusters have checklists\n• Field adjuster authority is higher than most carriers — a strong first call can settle issues that would take 3 rounds elsewhere\n• Their independent adjuster network (CAT adjusters during storm season) varies significantly in quality — document everything regardless\n\nAnyone with significant Travelers volume?',
 'pending_approval','carrier_intelligence','2026-08-17'),

-- Aug 18 — supplement_tips
('facebook_post','social','facebook_group',
 'Year-end supplement strategy: claim the depreciation before December 31',
 'A significant amount of recoverable depreciation expires unclaimed every year.',
 E'Most RCV policies allow depreciation recovery within 180 days of the ACV check date. Jobs completed in H1 often have depreciation recovery deadlines falling in Q4.\n\nAction items for every H1 job:\n1. Pull your ACV check date for each job\n2. Calculate the 180-day deadline\n3. Send homeowners a reminder 30 days before their deadline\n4. Help them compile and submit the documentation\n\nThe average recoverable depreciation on a $12K insurance job: $2,200.\n\nContractors who run this process capture an additional $88K on 40 annual insurance jobs — money that''s already been approved and is just waiting to be claimed.\n\nAre you tracking depreciation release deadlines?',
 'pending_approval','supplement_tips','2026-08-18'),

-- Aug 19 — business_ops
('facebook_post','social','facebook_group',
 'End of storm season: what separates the contractors who grew from the ones who just survived',
 'The difference isn''t talent. It''s systems.',
 E'Every storm season shakes out the same way:\n\n• Contractors without systems: made money, but it was chaos. Can''t repeat it consistently. Burned out.\n• Contractors with systems: made more money with less stress. Know exactly what to do next spring.\n\nThe system difference:\n1. A documented lead-to-close process\n2. A supplement workflow that captures code-required items every time\n3. A homeowner communication cadence that prevents every anxious call\n4. A post-job follow-up sequence that generates reviews and referrals automatically\n\nNone of these are complex. All of them take time to build. The time to build them is now, in the quiet weeks between storm season and winter.\n\nWhat''s the one system you''re building this fall?',
 'pending_approval','business_ops','2026-08-19'),

-- ══════════════════════════════════════════════════════════════════════════════
-- FACEBOOK PAGE  (days 31–60, Jun 21 – Jul 20)
-- ══════════════════════════════════════════════════════════════════════════════

-- Jun 21 — code_compliance
('facebook_post','social','facebook_page',
 'Code compliance: the supplement category growing fastest in 2026',
 'Contractors who know the IRC are winning more supplement battles than ever.',
 E'Code-required items are now the #1 fastest-growing supplement category — because they''re the hardest to deny.\n\nWhen a line item is required by local code, the adjuster has no discretionary authority to exclude it. The only argument is whether the code applies — and proper citations end that argument immediately.\n\nThe highest-value code-required items by frequency:\n• Ventilation upgrades (IRC R806)\n• Ice & water shield (varies by climate zone)\n• Drip edge at all eaves and rakes\n• Starter strip (separate from shingle coverage)\n\nRoofing OS tracks code requirements by jurisdiction automatically. See how it works at roofingos.dev?ref=fb',
 'pending_approval','code_compliance','2026-06-21'),

-- Jun 22 — supplement_tips
('facebook_post','social','facebook_page',
 'The average roofing contractor leaves $18,400/year in supplements on the table',
 'That''s not a typo. And it''s almost entirely recoverable.',
 E'Across thousands of insurance claims, the average contractor recovers only 61% of what they''re entitled to on first submission.\n\nThe gap: $1,800–$2,400 per qualifying job, primarily in:\n• Code-required items without citations\n• Missing flashing itemization\n• Ventilation exclusions without counter-documentation\n• O&P omissions on multi-trade jobs\n\nOn 40 insurance jobs/year, that gap compounds to $72K–$96K in missed recovery.\n\nThe contractors closing that gap aren''t working harder — they''re documenting better.\n\nSee the supplement tools at roofingos.dev?ref=fb →',
 'pending_approval','supplement_tips','2026-06-22'),

-- Jun 23 — homeowner_communication
('facebook_post','social','facebook_page',
 'Why homeowners choose roofing contractors: it''s not price',
 'The data is clear. And it changes how you should be selling.',
 E'In homeowner surveys about roofing contractor selection:\n\n• 67% cite "trust and communication" as the primary factor\n• 54% say a branded, professional portal or communication system increases their confidence\n• Only 22% say price was the deciding factor (most were mid-range bids, not lowest)\n\nMeaning: the contractor who communicates better closes at a higher price point with a higher close rate.\n\nThe tools that signal professionalism: a homeowner-facing portal, bilingual documentation, photo updates, and warranty transparency.\n\nRoofing OS homeowner portal is free — try it on your next job: roofingos.dev?ref=fb',
 'pending_approval','homeowner_communication','2026-06-23'),

-- Jun 24 — storm_strategy
('facebook_post','social','facebook_page',
 'Hail season 2026: which markets are seeing the most claim activity',
 'Real data from real storm events. Know where the opportunity is.',
 E'Active storm markets as of June 2026:\n\n⛈️ Colorado Front Range: Multiple hail events, 1"–2.25" recorded\n⛈️ North Texas (DFW metro): Active storm season, high claim volume\n⛈️ Central Ohio: Late-season severe weather driving inspections\n⛈️ Southeast Georgia: Above-normal storm activity\n⛈️ Illinois (Chicago suburbs): Significant hail events in May–June\n\nContractors in these markets with Aria outbound calling are queuing inspections automatically within 1 hour of storm detection.\n\nLearn how storm detection works at roofingos.dev?ref=fb →',
 'pending_approval','storm_strategy','2026-06-24'),

-- Jun 25 — business_ops
('facebook_post','social','facebook_page',
 '5 metrics every roofing contractor should know cold',
 'You can''t improve what you don''t measure. Start with these five.',
 E'The 5 metrics that define a roofing business''s health:\n\n1️⃣ Estimate-to-close rate (target: 30%+)\n2️⃣ Average job value (track month over month)\n3️⃣ Supplement recovery rate (% of denied items recovered)\n4️⃣ Days from signed contract to install start\n5️⃣ Review rate (% of completed jobs that leave a Google review)\n\nMost contractors track #2 only. The ones who track all five grow 2–3x faster because they know exactly which lever to pull.\n\nRoofing OS dashboard surfaces all five automatically.\n\nSee it at roofingos.dev?ref=fb →',
 'pending_approval','business_ops','2026-06-25'),

-- Jun 26 — lead_gen
('facebook_post','social','facebook_page',
 'The referral flywheel: how top roofing contractors generate 40% of leads from past customers',
 'Referrals don''t happen by accident. They happen by system.',
 E'The referral flywheel has three parts:\n\n1. Deliver a remarkable experience (portal updates, professional documentation, bilingual communication)\n2. Ask at the right moment (48–72 hours after job completion, personal message)\n3. Make referring easy (unique referral link, $200 credit, shareable portal photos)\n\nContractors running a structured referral system average 1.2 referrals per 10 completed jobs. At 40 jobs/year, that''s 5 additional jobs — roughly $40K in revenue — from past customers at $0 acquisition cost.\n\nRoofing OS portal includes referral tracking and unique codes out of the box.\n\nExplore the portal at roofingos.dev?ref=fb →',
 'pending_approval','lead_gen','2026-06-26'),

-- Jun 27 — carrier_intelligence
('facebook_post','social','facebook_page',
 'Carrier approval rates by documentation quality: the research is conclusive',
 'The relationship between documentation quality and supplement approval rate is direct and measurable.',
 E'Research findings from insurance claim data:\n\n• Claims with organized photo documentation + code citations: 82% first-round approval\n• Claims with photos only (no citations): 54% first-round approval\n• Claims with citations only (no photos): 61% first-round approval\n• Claims with neither: 31% first-round approval\n\nThe combination of photos + code citations produces the highest approval rate by a significant margin.\n\nRoofing OS supplement analyzer pulls relevant code citations automatically for your jurisdiction, paired with your uploaded photos.\n\nLearn more at roofingos.dev?ref=fb →',
 'pending_approval','carrier_intelligence','2026-06-27'),

-- Jun 28 — homeowner_communication
('facebook_post','social','facebook_page',
 'The homeowner portal: what it is, what it does, and why it''s free',
 'We get this question a lot. Here''s the straightforward answer.',
 E'The Roofing OS homeowner portal gives your clients a branded, mobile-friendly window into their job — without installing an app.\n\nWhat they see:\n✅ Job status and milestone updates\n✅ Before/after photos organized by stage\n✅ Insurance claim status\n✅ Supplement progress\n✅ Documents and warranty info\n✅ A direct message thread to your office\n\nWhy it''s free: we believe every roofing contractor should be able to give their homeowners a professional experience. The portal is funded by our paid tools (Aria AI, supplement analyzer, CRM).\n\nSet it up on your next job at roofingos.dev?ref=fb →',
 'pending_approval','homeowner_communication','2026-06-28'),

-- Jun 29 — business_ops
('facebook_post','social','facebook_page',
 'The roofing contractor financial stack: what you actually need and what''s overkill',
 'Financial clarity for a growing roofing business.',
 E'What every roofing contractor needs financially:\n\n✅ Separate business checking account (non-negotiable)\n✅ A way to track job-level profitability (not just total revenue)\n✅ A draw schedule in every contract (deposit → milestone → completion)\n✅ 60 days of fixed costs in reserve before peak season\n\nWhat''s overkill early on:\n❌ Dedicated CFO software before $500K revenue\n❌ Multi-entity structure before you have real liability exposure\n❌ A bookkeeper before you have consistent monthly volume\n\nThe biggest financial mistake: treating insurance revenue as income the day the check arrives. It''s income when the job is complete and supplemented.\n\nMore business ops insights at roofingos.dev?ref=fb →',
 'pending_approval','business_ops','2026-06-29'),

-- Jun 30 — supplement_tips
('facebook_post','social','facebook_page',
 'The supplement gap analysis: find the money you''re leaving behind',
 'A 10-minute review of any estimate reveals the missed items. Here''s the framework.',
 E'Run this gap analysis on your last 5 insurance estimates:\n\n□ Is drip edge itemized at correct LF (not included in shingles)?\n□ Is starter strip a separate line item?\n□ Is each pipe penetration individually itemized?\n□ Does the ventilation match the IRC calculation for attic sq footage?\n□ Are all valleys itemized separately?\n□ Is step flashing at all walls and dormers included?\n□ If GC coordination: is O&P present?\n□ Is ice & water shield at correct square footage for climate zone?\n□ Are all haul-away / disposal fees present?\n\nIf you checked "no" on 3 or more: you''re leaving $1,200–$3,000 per job.\n\nAutomate this analysis at roofingos.dev?ref=fb →',
 'pending_approval','supplement_tips','2026-06-30'),

-- Jul 1 — storm_strategy
('facebook_post','social','facebook_page',
 'Aria AI storm trigger: how it works and what it does automatically',
 'When hail falls in your market, Aria is already working.',
 E'Here''s the storm trigger sequence in Roofing OS:\n\n1. Aria detects a hail event ≥1" in your monitored ZIP codes\n2. Aria cross-references your existing customer list against the affected area\n3. Outbound calls are queued within the hour — past customers first, then your prospect list\n4. Aria qualifies the lead, sets the inspection, and logs the call outcome\n5. You receive a dashboard notification with the inspection pipeline\n\nAll TCPA-compliant. No calls before 9am or after 4:30pm local time. No calls to numbers on your DNC list.\n\nResult: contractors using the storm trigger book 8–14 more inspections per hail event than those calling manually.\n\nSee the Aria AI at roofingos.dev?ref=fb →',
 'pending_approval','storm_strategy','2026-07-01'),

-- Jul 2 — lead_gen
('facebook_post','social','facebook_page',
 'The free roof inspection offer: why it works and how to use it without devaluing your time',
 'The highest-converting offer in residential roofing when structured correctly.',
 E'The free inspection offer converts well because it removes all risk from the homeowner''s side. But it only works if you protect your time.\n\nRules for the free inspection:\n\n1. Set a 20-minute expectation: "I''ll be on-site for about 20 minutes."\n2. Bring a tablet and your estimate software — you close same-day or not at all\n3. Take photos during the inspection and show the homeowner before you leave\n4. Leave a PDF condition report regardless of whether they sign — your name is on it and it comes back\n\nClose rate from structured free inspections: 35–45%. From unstructured "just come look at it" visits: 12–18%.\n\nTrack your inspection pipeline at roofingos.dev?ref=fb →',
 'pending_approval','lead_gen','2026-07-02'),

-- Jul 3 — homeowner_communication
('facebook_post','social','facebook_page',
 'Independence Day weekend: a quick message from Roofing OS',
 'To the crews working through the holiday — you make this industry run.',
 E'To every roofing contractor working through this holiday weekend:\n\nStorm season doesn''t take weekends off, and neither do you. The homeowners who called today because their roof is leaking after last week''s hail — you''re who they''re counting on.\n\nWe built Roofing OS for you. Not for the carriers, not for the adjusters — for the contractors who do the actual work.\n\nStay safe up there, and enjoy the downtime when you get it.\n\n— The Roofing OS team\n\nroofingos.dev?ref=fb',
 'pending_approval','homeowner_communication','2026-07-03'),

-- Jul 4 — business_ops
('facebook_post','social','facebook_page',
 'What does "running a tight operation" actually mean for a roofing contractor?',
 'Not overhead — throughput. Here''s the mindset shift.',
 E'"Tight operation" doesn''t mean the lowest overhead. It means the highest output per hour of work.\n\nLoose operations: lots of calls back to the homeowner, lots of re-visits to the job site, lots of supplement rounds, lots of chasing unpaid invoices.\n\nTight operations: one call to set expectations, one site visit per phase, one supplement round, milestone-triggered invoices.\n\nThe tools that create a tight operation:\n• A homeowner portal that answers questions before they''re asked\n• A supplement workflow that captures everything in the first submission\n• A payment schedule tied to job milestones\n\nRoofing OS is built for a tight operation. Explore at roofingos.dev?ref=fb →',
 'pending_approval','business_ops','2026-07-04'),

-- Jul 5 — supplement_tips
('facebook_post','social','facebook_page',
 'How the Roofing OS supplement analyzer works (and why it finds more than most contractors catch)',
 'AI-assisted supplement analysis isn''t about replacing your expertise — it''s about the checklist you run at 6pm on a Friday.',
 E'Here''s what the Roofing OS supplement analyzer does:\n\n1. You upload an insurance estimate PDF\n2. It identifies every line item present and every standard line item missing\n3. It cross-references your jurisdiction''s code requirements (CO, TX, FL, GA, OH, IL currently)\n4. It flags carrier-specific patterns (known approval behaviors for State Farm, Allstate, USAA, etc.)\n5. It generates a draft supplement package with photos organized by line item\n\nYou review, adjust, and submit.\n\nAverage additional recovery identified per job: $1,400–$2,200.\n\nTry it at roofingos.dev?ref=fb →',
 'pending_approval','supplement_tips','2026-07-05'),

-- Jul 6 — carrier_intelligence
('facebook_post','social','facebook_page',
 'Carrier intelligence built into every estimate: how it changes your approach',
 'Knowing how your carrier behaves before you submit changes your strategy.',
 E'Roofing OS carrier intelligence layer:\n\nBefore you submit an estimate, the system surfaces:\n• This carrier''s average approval rate for key line items\n• Known documentation requirements (photo formats, code citation styles)\n• Typical payment timeline (ACV → RCV window)\n• Historical behavior on O&P, ventilation, and decking\n\nExample: Allstate requires photos for every disputed line — if you know that before submission, you organize your package differently than for State Farm.\n\nKnowing the carrier''s tendencies is like knowing what the judge values before your court date.\n\nExplore carrier intelligence at roofingos.dev?ref=fb →',
 'pending_approval','carrier_intelligence','2026-07-06'),

-- Jul 7 — code_compliance
('facebook_post','social','facebook_page',
 'Local code lookup: the feature that makes supplement citations instant',
 'The right IRC section in the right supplement ends the argument before it starts.',
 E'The Roofing OS code compliance lookup:\n\nEnter your job''s ZIP code → the system pulls the locally adopted code edition and jurisdiction-specific amendments.\n\nFor every supplement line item, it surfaces the exact code section you need to cite:\n• R905.2.8 for drip edge requirements\n• R806.5 for ventilation calculations\n• Table R301.2 for climate zone-specific requirements\n• Local amendments that supersede IRC\n\nYou don''t need to memorize code books. You need to cite the right section at the right time.\n\nCurrently covers: Colorado, Texas, Florida, Georgia, Ohio, Illinois. Adding more states monthly.\n\nTry it at roofingos.dev?ref=fb →',
 'pending_approval','code_compliance','2026-07-07'),

-- Jul 8 — storm_strategy
('facebook_post','social','facebook_page',
 'Storm detection to booked inspection: the Roofing OS timeline',
 'From hail event to call queued: under 60 minutes.',
 E'Here''s the actual timeline when a hail event triggers in a monitored ZIP:\n\n⚡ T+0: Storm detection API registers hail event (1"+ threshold)\n⚡ T+5 min: Roofing OS cross-references customer list vs. affected ZIPs\n⚡ T+15 min: Outbound call queue built, prioritized by address proximity to hail center\n⚡ T+30 min: Aria AI begins outbound calls — past customers first\n⚡ T+60 min: First inspection typically booked\n⚡ T+4 hours: Outbound queue complete, dashboard updated with results\n\nAll TCPA-compliant. You receive a Telegram notification when the queue is built.\n\nSee storm detection in action at roofingos.dev?ref=fb →',
 'pending_approval','storm_strategy','2026-07-08'),

-- Jul 9 — lead_gen
('facebook_post','social','facebook_page',
 'Roofing OS prospector: how 300 new leads show up in your pipeline weekly',
 'Outreach shouldn''t be your job. It should be automated.',
 E'The Roofing OS outreach engine runs weekly:\n\n1. Identifies roofing contractors in your target markets who haven''t yet signed up\n2. Scores leads by hail history, business age, crew size indicators, and digital presence\n3. Enrolls high-score leads in a 16-touch email sequence automatically\n4. Flags whale leads (clicked portal, opened 3+ emails) for personal follow-up\n5. Surfaces everything in the outreach dashboard\n\nNo manual prospecting. No list purchases. The pipeline runs itself.\n\nSee the outreach system at roofingos.dev?ref=fb →',
 'pending_approval','lead_gen','2026-07-09'),

-- Jul 10 — homeowner_communication
('facebook_post','social','facebook_page',
 'What homeowners say they wish their roofing contractor had done better',
 'Survey data from 1,200 homeowners who had roof replacements in 2024–2025.',
 E'Top homeowner complaints about roofing contractors:\n\n1. "I didn''t know what was happening for weeks" — 48%\n2. "The timeline wasn''t what I was told" — 41%\n3. "I had to call multiple times to get updates" — 39%\n4. "I couldn''t find my warranty documents" — 27%\n5. "I didn''t understand what was covered by insurance" — 34%\n\nNone of these are complaints about the roof quality. All of them are solved by a communication system.\n\nRoofing OS homeowner portal addresses all five — automatically, at no cost to the contractor.\n\nSet up the portal on your next job at roofingos.dev?ref=fb →',
 'pending_approval','homeowner_communication','2026-07-10'),

-- ══════════════════════════════════════════════════════════════════════════════
-- FACEBOOK PAGE  (days 61–90, Jul 21 – Aug 19)
-- ══════════════════════════════════════════════════════════════════════════════

-- Jul 21 — supplement_tips
('facebook_post','social','facebook_page',
 'Supplement recovery by job size: where the biggest gaps are',
 'The highest-dollar supplement opportunities aren''t always on the biggest jobs.',
 E'Counter-intuitive finding from claims data:\n\nMid-size jobs ($8K–$15K) have the highest supplement recovery opportunity as a % of job value — not large commercial jobs.\n\nWhy: large commercial jobs get more scrutiny from both sides. Small residential jobs have less room. Mid-size residential insurance jobs are where adjusters move quickly and contractors often don''t push back.\n\nThe sweet spot: a $10K residential insurance job with 1–2 denied supplement line items. Average recovery: $1,800. Most contractors spend 15 minutes on that supplement. ROI: $7,200/hour.\n\nAre you tracking supplement recovery rate by job size?\n\nroofingos.dev?ref=fb →',
 'pending_approval','supplement_tips','2026-07-21'),

-- Jul 22 — business_ops
('facebook_post','social','facebook_page',
 'The Roofing OS contractor dashboard: what you see every morning',
 'Your business at a glance. No spreadsheets, no manual updates.',
 E'When you log into the Roofing OS contractor dashboard each morning:\n\n📊 Active jobs: status, crew assigned, next milestone\n📊 Open estimates: age, close probability, follow-up needed\n📊 Supplement queue: items pending, items in review, avg recovery\n📊 Aria call results: last night''s outbound, inspections booked\n📊 Homeowner messages: any unread portal messages from homeowners\n📊 Storm alerts: any active hail events in your ZIPs\n\nAll in one screen. Nothing to update manually — it''s all live from your job records.\n\nPortal Pro is $69/month. Free 30-day trial at roofingos.dev?ref=fb →',
 'pending_approval','business_ops','2026-07-22'),

-- Jul 23 — lead_gen
('facebook_post','social','facebook_page',
 'Why roofing contractors with more reviews close at a higher price',
 'Volume reviews don''t just increase lead conversion — they increase average job value.',
 E'Data from market analysis:\n\nContractors with 50+ Google reviews close at an average of 8–12% higher price point than contractors with fewer than 20 reviews — for identical scope of work.\n\nWhy: review volume signals established trust. Homeowners who see 150 reviews subconsciously anchor the contractor as premium. They negotiate less and accept higher estimates.\n\nBreak-even on a review generation system: recovering 3% more per job on 20 jobs/year at $10K average = $6,000. Most review tools cost $600–$900/year.\n\nRoofing OS post-job follow-up sequence automates review requests at the optimal timing.\n\nroofingos.dev?ref=fb →',
 'pending_approval','lead_gen','2026-07-23'),

-- Jul 24 — storm_strategy
('facebook_post','social','facebook_page',
 'Case study: how one Colorado contractor booked 23 inspections from a single hail event',
 'The system that made it happen.',
 E'A Front Range contractor using Roofing OS activated the storm trigger after a June hail event (1.75" in 4 ZIP codes).\n\nWhat happened automatically:\n• 847 addresses cross-referenced against hail path\n• 94 past customers identified in affected ZIPs\n• Aria queued 94 outbound calls within 40 minutes\n• 67 connected calls, 23 inspections booked\n• 14 jobs signed within 10 days\n• Estimated revenue: $148,000\n\nManual approach (same contractor, prior season): 6 inspections from the same storm size.\n\nThe difference: 3.8x more inspections. Same storm. Same contractor. Different system.\n\nSee how it works at roofingos.dev?ref=fb →',
 'pending_approval','storm_strategy','2026-07-24'),

-- Jul 25 — homeowner_communication
('facebook_post','social','facebook_page',
 'The bilingual portal: serving Spanish-speaking homeowners at scale',
 'One setup. Every job automatically in English and Spanish.',
 E'More than 40 million Spanish-speaking homeowners in the US. A growing percentage of roof replacement customers in the fastest-growing metros.\n\nRoofing OS portal supports both languages automatically:\n\n• Job status updates auto-translated\n• Document summaries in Spanish\n• Milestone notifications in the homeowner''s preferred language\n• Contractor messages translated in-thread\n\nYou write in English. Your homeowner reads in Spanish. No extra work on your end.\n\nContractors serving bilingual markets with the Spanish portal see significantly higher referral rates from their Spanish-speaking homeowners — community referrals are the highest-value lead source in those markets.\n\nroofingos.dev?ref=fb →',
 'pending_approval','homeowner_communication','2026-07-25'),

-- Jul 26 — supplement_tips
('facebook_post','social','facebook_page',
 'AI-generated supplement rebuttal letters: what they look like and when they work',
 'A well-structured rebuttal letter closes most first-tier denials. Here''s the anatomy.',
 E'Anatomy of a rebuttal letter that gets approved:\n\n1. Header: Claim number, property address, date of loss, contractor license\n2. Statement of facts: What the adjuster denied and why (summarize their language)\n3. Counter-evidence: Photos with GPS + timestamps, code citations, prior approvals for same line items\n4. Specific ask: "We request approval of [line item] at [amount] per the attached documentation"\n5. Response deadline: "We respectfully request a response within 10 business days per [state] insurance code"\n\nRoofing OS generates these letters from your job documentation automatically. You review and send.\n\nAverage first-round rebuttal success rate: 68%.\n\nroofingos.dev?ref=fb →',
 'pending_approval','supplement_tips','2026-07-26'),

-- Jul 27 — carrier_intelligence
('facebook_post','social','facebook_page',
 'Why your supplement success rate varies by carrier (and what to do about it)',
 'Each carrier has a different process. Contractors who know the process win more.',
 E'Supplement approval rates by carrier documentation standard (from aggregate data):\n\n• State Farm: 77% first-round when fully documented\n• USAA: 81% first-round (highest) — strict but pays\n• Allstate: 65% first-round — requires photos on every line\n• Nationwide: 52% first-round — but 74% after first escalation\n• Progressive: 58% first-round — improving with AI photo analysis\n• Farmers: 61% first-round — written rebuttals outperform phone\n\nThe carriers with lower first-round rates aren''t less profitable — they just require a second step most contractors skip.\n\nCarrier intelligence is built into every Roofing OS supplement analysis.\n\nroofingos.dev?ref=fb →',
 'pending_approval','carrier_intelligence','2026-07-27'),

-- Jul 28 — code_compliance
('facebook_post','social','facebook_page',
 'Climate zone compliance: why your ZIP code determines your supplement strategy',
 'The same roof detail is code-required in one ZIP and optional in another.',
 E'IRC climate zones determine which items are code-required vs. recommended:\n\nZone 1–2 (FL south, TX south): No ice & water minimum, enhanced wind resistance required\nZone 3–4 (GA, TX north, CO south): Ice & water at eaves, valleys, code-required on low-slope\nZone 5 (CO north, IL, OH): Extended ice & water requirements, enhanced ventilation thresholds\nZone 6–7 (mountain CO, upper midwest): Full ice & water, R-49+ attic insulation on reroofs touching attic\n\nKnowing your zone means knowing which items are non-negotiable in supplements.\n\nRoofing OS code lookup identifies your zone and the applicable requirements automatically.\n\nroofingos.dev?ref=fb →',
 'pending_approval','code_compliance','2026-07-28'),

-- Jul 29 — lead_gen
('facebook_post','social','facebook_page',
 'Roofing OS outreach by the numbers: what happens when the system runs for 90 days',
 'Real pipeline growth from automated outreach.',
 E'90-day outreach results from Roofing OS automated prospecting:\n\n📧 Emails sent: 2,400+\n📧 Average open rate: 31% (industry avg: 21%)\n📧 Replies and inquiries: 94\n📧 Demo/portal activations: 31\n📧 Signed contractors: 8\n\nRevenue from automated outreach in 90 days: $32,800 in new contractor subscriptions.\n\nNo manual prospecting. No cold calling. One system running in the background.\n\nThe outreach engine runs the same way for your business — finding leads, sequencing emails, surfacing hot prospects for personal follow-up.\n\nSee the outreach tools at roofingos.dev?ref=fb →',
 'pending_approval','lead_gen','2026-07-29'),

-- Jul 30 — homeowner_communication
('facebook_post','social','facebook_page',
 'Post-job: the 5 automations that turn a completed roof into recurring revenue',
 'The job ends. The relationship doesn''t.',
 E'Roofing OS post-job automation sequence:\n\nDay 1: Warranty document + completion confirmation to homeowner portal\nDay 3: Google review request (direct link, personal message format)\nDay 7: Referral invite with unique link and $200 credit\nDay 30: 30-day check-in + roof tip\nDay 365: Annual inspection offer + storm season reminder\n\nEach step runs automatically from job close. You don''t have to remember to do any of it.\n\nContractors running this sequence average 1.3 reviews per 5 completed jobs (vs. 0.4 for manual requests) and 0.9 referrals per 10 jobs.\n\nTry Roofing OS free at roofingos.dev?ref=fb →',
 'pending_approval','homeowner_communication','2026-07-30'),

-- Jul 31 — business_ops
('facebook_post','social','facebook_page',
 'End of July: your storm season is half over. Is your business stronger?',
 'Revenue is one measure. Systems are the real indicator.',
 E'Every roofing contractor makes money during storm season. The question is: are you building a business or just surviving a busy period?\n\nDifference between seasonal revenue and a growing business:\n\n• Seasonal: Revenue spikes, then drops. No pipeline going into winter.\n• Growing: Revenue from storm season funds a system that generates leads year-round.\n\nThe investments that convert storm revenue into a growing business:\n• A review base (50+ reviews before next spring)\n• A past-customer list ready for reactivation\n• One referral partnership (realtor, PM company, adjacent trade)\n\nAll three of these can be built in 4 hours total. The time is now.\n\nBuild the system at roofingos.dev?ref=fb →',
 'pending_approval','business_ops','2026-07-31'),

-- Aug 1 — technology_tools
('facebook_post','social','facebook_page',
 'Roofing OS: what''s included free vs. what''s in Portal Pro',
 'Transparent pricing is a feature, not a footnote.',
 E'Free forever (no credit card required):\n✅ Homeowner portal — unlimited jobs\n✅ Photo storage — job-level organization\n✅ Basic job tracking — status, milestones\n✅ Warranty document storage\n✅ Customer communication thread\n\nPortal Pro ($69/month):\n⚡ Aria AI outbound calling (storm trigger + outreach)\n⚡ Supplement analyzer with carrier intelligence\n⚡ Code compliance lookup (6 states)\n⚡ Automated review and referral sequences\n⚡ Full pipeline CRM with team access\n⚡ Analytics dashboard\n\nMost contractors cover the Portal Pro cost on the first supplement it catches.\n\nStart free at roofingos.dev?ref=fb →',
 'pending_approval','technology_tools','2026-08-01'),

-- Aug 2 — storm_strategy
('facebook_post','social','facebook_page',
 'Late summer hail: why August claims are actually easier to settle',
 'Counter-intuitive but backed by data.',
 E'August insurance claims have some advantages over spring storm claims:\n\n• Adjuster backlog is higher but staffing is typically increased — field adjusters are more experienced\n• Fewer CAT team assignments mean more consistent adjuster quality\n• Homeowners are more available for inspection scheduling (vs. spring when schedules are packed)\n• Material lead times are typically shorter — August supplements don''t wait for material confirmation\n• Carriers are managing annual loss ratios — some are more motivated to close claims in Q3\n\nThe disadvantage: approval timelines are longer. Counter it with thorough documentation up front.\n\nRoofing OS storm tools work the same in August as April.\n\nroofingos.dev?ref=fb →',
 'pending_approval','storm_strategy','2026-08-02'),

-- Aug 3 — supplement_tips
('facebook_post','social','facebook_page',
 'The Roofing OS supplement package: from uploaded estimate to ready-to-send in 8 minutes',
 'This is the workflow that changes how you approach every insurance job.',
 E'Here''s the actual workflow:\n\n1. Upload insurance estimate PDF (2 min)\n2. Supplement analyzer identifies gaps + code citations (instant)\n3. Review the flagged line items — approve or override each (3 min)\n4. System generates the formatted supplement package with your photos attached (instant)\n5. Review the cover page and summary table (2 min)\n6. Send directly from the platform to the adjuster''s email (1 min)\n\nTotal: ~8 minutes vs. 2–4 hours manually.\n\nThe quality is higher too — organized, cited, formatted exactly how adjusters process fastest.\n\nSee the supplement tools at roofingos.dev?ref=fb →',
 'pending_approval','supplement_tips','2026-08-03'),

-- Aug 4 — carrier_intelligence
('facebook_post','social','facebook_page',
 'Insurance carrier update: what''s changed in claims processing in 2026',
 'Carrier behavior shifts. Staying current matters.',
 E'2026 changes we''re tracking in carrier behavior:\n\n• AI photo analysis now deployed by 3 major carriers for initial estimate review — photo quality and organization matter more than ever\n• Remote desktop inspections (carrier-directed) increasing — document everything before the remote session\n• Progressive tightening documentation requirements for claims over $10K\n• State Farm implementing faster ACV payment timelines in CO and TX markets\n• Nationwide adding new appeal pathway for contractor-submitted supplements\n\nCarrier intelligence in Roofing OS is updated as these patterns emerge from claims data.\n\nStay current at roofingos.dev?ref=fb →',
 'pending_approval','carrier_intelligence','2026-08-04'),

-- Aug 5 — lead_gen
('facebook_post','social','facebook_page',
 'Fall campaign timing: why September emails close jobs in November',
 'The roofing sales cycle means you need to plant seeds now.',
 E'Average roofing sales cycle from initial contact to signed contract: 3–6 weeks.\nFrom signed contract to job start: 2–6 weeks.\n\nIf you send fall inspection emails in September:\n• Contacts open emails in weeks 1–2\n• Inspections scheduled in weeks 2–4\n• Contracts signed weeks 4–6\n• Jobs installed October–November (before first freeze)\n\nIf you wait until October to start the campaign:\n• You''re trying to schedule jobs in November–December\n• Weather windows are narrowing\n• Homeowners defer until spring\n\nThe calendar math is clear. September is when fall revenue is won.\n\nBuild your outreach list at roofingos.dev?ref=fb →',
 'pending_approval','lead_gen','2026-08-05'),

-- Aug 6 — homeowner_communication
('facebook_post','social','facebook_page',
 'The warranty experience: what separates a forgettable contractor from a referred one',
 'Your warranty is either a marketing asset or a piece of paper they never find again.',
 E'What makes a warranty a marketing asset:\n\n1. It''s in the homeowner portal — searchable, accessible from their phone, forever\n2. It''s written in plain English — not manufacturer legalese\n3. It explicitly tells them what to do first if there''s an issue (call you, not the manufacturer)\n4. It comes with an annual reminder the contractor sends proactively\n\nA homeowner who can find their warranty in 10 seconds tells their neighbor about their contractor. A homeowner who can''t find it files the complaint.\n\nRoofing OS stores and serves warranty docs automatically from job close.\n\nroofingos.dev?ref=fb →',
 'pending_approval','homeowner_communication','2026-08-06'),

-- Aug 7 — business_ops
('facebook_post','social','facebook_page',
 'The off-season game plan: what the best roofing contractors do from November to March',
 'Off-season is when competitive advantages are built.',
 E'What the growing contractors do in the off-season:\n\n📋 Month 1 (Nov): Review the year''s numbers. Close out all open supplements. Request final RCV payments.\n📋 Month 2 (Dec): Build or refresh the customer list. Launch the review collection campaign.\n📋 Month 3 (Jan): Pre-storm marketing — "Is your roof ready for spring?" campaign.\n📋 Month 4 (Feb): Schedule spring inspections. Early-bird offers for past customers.\n📋 Month 5 (Mar): Pipeline full before storm season starts.\n\nContractors who start spring with a full pipeline win the whole year. That pipeline is built in the off-season.\n\nBuild the system now at roofingos.dev?ref=fb →',
 'pending_approval','business_ops','2026-08-07'),

-- Aug 8 — supplement_tips
('facebook_post','social','facebook_page',
 'Recoverable depreciation: the unclaimed money sitting in your closed jobs right now',
 'Most roofing contractors don''t run this process. It''s pure margin.',
 E'On every RCV insurance job, the carrier holds back 15–30% as depreciation and releases it after installation confirmation.\n\nProcess most contractors run: they get the ACV check, complete the job, and wait for the homeowner to figure out the rest.\n\nProcess that captures the money:\n1. Note the ACV check date on every job\n2. Set a 45-day reminder (before the 180-day expiration)\n3. Send the homeowner a message with the exact documents needed + the amount at stake\n4. Help them submit\n\nAverage recoverable depreciation: $2,200 per job. Recovery rate with this process: 82%. Without it: 31%.\n\nRoofing OS depreciation tracker automates steps 1–3.\n\nroofingos.dev?ref=fb →',
 'pending_approval','supplement_tips','2026-08-08'),

-- Aug 9 — storm_strategy
('facebook_post','social','facebook_page',
 'Hurricane prep for Gulf Coast contractors: the Roofing OS storm response playbook',
 'Atlantic hurricane season peaks August–October. Be ready before it hits.',
 E'For Gulf Coast and Southeast contractors, the Roofing OS hurricane response:\n\nPre-storm:\n• Customer list exported and backed up offline\n• Material supplier emergency contacts documented\n• Aria call queue pre-loaded with customer list, ready to activate post-event\n\nPost-storm (T+0 to T+24 hours):\n• Aria activates automatically when storm event is registered\n• Outbound calls begin — past customers first, then prospect list\n• Portal photos organized for rapid documentation\n\nPost-storm (T+24 to T+72):\n• Supplement packages queued for all insurance jobs\n• Carrier intelligence surfaced for likely adjusters in the area\n\nStorm prep is a system, not a reaction.\n\nroofingos.dev?ref=fb →',
 'pending_approval','storm_strategy','2026-08-09'),

-- Aug 10 — technology_tools
('facebook_post','social','facebook_page',
 'The Aria AI calling system: what it says, what it does, and what it doesn''t do',
 'Transparency on how the AI calling system actually works.',
 E'Aria is a TCPA-compliant AI voice system for outbound roofing contractor calls.\n\nWhat Aria does:\n✅ Qualify leads (confirm they''re the homeowner, confirm storm date, confirm interest)\n✅ Set inspection appointments\n✅ Follow up on open estimates (non-pushy check-in)\n✅ Reactivate past customers after hail events\n\nWhat Aria doesn''t do:\n❌ Close deals — that''s still your conversation\n❌ Call outside 9am–4:30pm local time\n❌ Call numbers on your DNC list\n❌ Claim to be human if asked directly\n\nAria handles the outreach volume you can''t handle personally. You handle the conversations that matter.\n\nSee Aria at roofingos.dev?ref=fb →',
 'pending_approval','technology_tools','2026-08-10'),

-- Aug 11 — carrier_intelligence
('facebook_post','social','facebook_page',
 'State insurance department complaints: when to file and what to expect',
 'This tool exists. Most contractors never use it.',
 E'When a carrier systematically denies legitimate claims, your state''s Department of Insurance exists to investigate.\n\nWhen to file:\n• Pattern of unexplained denials on code-required items\n• Failure to respond to supplements within the state-mandated window\n• ACV vs. RCV disputes where the policy clearly covers RCV\n• Intimidation tactics from adjusters\n\nWhat to expect:\n• Most states require carrier response within 15–30 days of a DOI complaint\n• Carriers take DOI complaints seriously — it''s a regulatory record\n• ~62% of roofing-related DOI complaints result in partial or full payment\n• No cost to file\n\nDOI complaint links for all 50 states are in the Roofing OS supplement tools.\n\nroofingos.dev?ref=fb →',
 'pending_approval','carrier_intelligence','2026-08-11'),

-- Aug 12 — lead_gen
('facebook_post','social','facebook_page',
 '10 years of roofing sales data in one chart: when homeowners are most likely to sign',
 'Timing your outreach correctly doubles your close rate.',
 E'Peak decision-making windows for roofing contracts:\n\n🔥 1–3 days after hail event: 45–55% close rate (urgency high)\n🔥 Day of or day after free inspection: 35–45% close rate (information fresh)\n📈 January–March: 28–35% (early season, competition lower)\n📉 August–September: 22–28% (homeowners distracted, budget spent on summer)\n📉 November–December: 18–22% (weather hesitation, holiday budgets)\n\nBest prospecting time: when urgency and information are both present — post-storm, post-inspection.\n\nWorst prospecting time: cold outreach in August without a storm trigger.\n\nRoofing OS Aria calls at the right moment automatically.\n\nroofingos.dev?ref=fb →',
 'pending_approval','lead_gen','2026-08-12'),

-- Aug 13 — code_compliance
('facebook_post','social','facebook_page',
 'The permit that protects you from a liability claim 5 years from now',
 'Pull permits on everything. The cost is $75. The protection is unlimited.',
 E'A roofing permit creates a permanent public record:\n\n• The date work was performed\n• The scope of work\n• That the work was inspected and passed\n• The contractor license number\n\nWithout a permit, a homeowner can claim 3 years from now that your installation was defective. With a permit, the jurisdiction''s inspection is on record as confirmation of code compliance.\n\nThe supplement benefit: a permit with inspector sign-off is your strongest evidence against "pre-existing damage" arguments. The carrier can''t claim damage predates the repair when there''s a dated permit.\n\nPull permits on everything. It''s table stakes.\n\nroofingos.dev?ref=fb →',
 'pending_approval','code_compliance','2026-08-13'),

-- Aug 14 — supplement_tips
('facebook_post','social','facebook_page',
 'Supplement automation: what it means to never submit a disorganized package again',
 'The submission that gets reviewed in 24 hours vs. the one that sits for 3 weeks.',
 E'The supplement package structure that gets processed fastest:\n\n1. One-page summary table (line item | estimated cost | document reference)\n2. Photos organized by line item — not by date, not by roof section\n3. Code citations formatted as: "Per [code edition] Section [number]: [requirement text]"\n4. Carrier-specific documentation checklist compliance (Allstate: photo on every line; USAA: code section required)\n\nRoofing OS generates this structure automatically. You upload your job photos, it organizes them by the relevant supplement lines, attaches the right code citations, and produces a cover page.\n\nThe package the adjuster receives is organized exactly how they need it.\n\nroofingos.dev?ref=fb →',
 'pending_approval','supplement_tips','2026-08-14'),

-- Aug 15 — homeowner_communication
('facebook_post','social','facebook_page',
 'What your homeowner portal should look like on day 1 vs. day 90 of a claim',
 'The portal isn''t just a place to store documents. It''s a trust-building timeline.',
 E'Day 1 (contract signed): Portal created, homeowner receives magic link (no app download), sees initial inspection photos and claim status "Submitted"\n\nWeek 2: Portal shows "Adjuster inspection scheduled" + date, photos from contractor inspection uploaded\n\nWeek 4: "Supplement submitted" with summary of what was added and estimated recovery\n\nWeek 6: "Carrier approved" with payment summary, materials ordered, installation date confirmed\n\nDay 60–70: Installation complete, before/after photos, warranty document uploaded, final invoice\n\nDay 90: Review request + referral invite auto-sent\n\nThe homeowner who sees this timeline trusts you completely.\n\nBuild this experience at roofingos.dev?ref=fb →',
 'pending_approval','homeowner_communication','2026-08-15'),

-- Aug 16 — business_ops
('facebook_post','social','facebook_page',
 'The roofing contractor competitive landscape: what 2026 data tells us',
 'The market is shifting. Here''s what to know.',
 E'2026 roofing market dynamics:\n\n• Average number of roofing contractors per market is up 18% since 2022 (barrier to entry dropped)\n• Average close rate across all markets: dropped from 31% to 26% (more competition)\n• Average review count for page-1 Google contractors: up from 47 to 112\n• Digital lead generation: now represents 58% of residential leads (up from 41% in 2022)\n• Homeowner expectations: "professional communication tools" cited by 54% as important in selection\n\nThe contractors winning in 2026 are the ones who differentiated early on communication and documentation — not price.\n\nDifferentiate at roofingos.dev?ref=fb →',
 'pending_approval','business_ops','2026-08-16'),

-- Aug 17 — storm_strategy
('facebook_post','social','facebook_page',
 'Your storm season debrief: 5 questions to ask before next April',
 'The contractors who improve fastest review every season systematically.',
 E'Run this debrief before November:\n\n1. What was my inspection-to-close rate this season vs. last? (If lower: follow-up problem or estimate quality)\n\n2. What was my average supplement recovery per job? (If under $1,000: documentation gap)\n\n3. Which lead source had the highest close rate? (Double down on that source)\n\n4. Which carrier gave me the most friction? (Build their-specific documentation process)\n\n5. What would I do differently during the first 72 hours post-storm?\n\nContractors who complete this debrief grow 1.4x faster the following season than those who just move on.\n\nTrack your metrics at roofingos.dev?ref=fb →',
 'pending_approval','storm_strategy','2026-08-17'),

-- Aug 18 — supplement_tips
('facebook_post','social','facebook_page',
 'Year-end supplement sweep: the 4-week sprint that captures unclaimed revenue',
 'September is the last window to recover H1 supplement denials before year-end.',
 E'The year-end supplement sprint:\n\nWeek 1: Audit all H1 closed jobs — pull every job where line items were denied and not supplemented\n\nWeek 2: Submit supplements on the 5 highest-value denied jobs (prioritize by denial amount)\n\nWeek 3: Follow up on any outstanding supplements from June–August\n\nWeek 4: Send depreciation recovery reminders to all H1 jobs with ACV checks issued\n\nAverage contractor who runs this sprint captures $12,000–$18,000 in previously written-off revenue.\n\nAll of this is documented and trackable in Roofing OS — you don''t have to hunt through files.\n\nroofingos.dev?ref=fb →',
 'pending_approval','supplement_tips','2026-08-18'),

-- Aug 19 — business_ops
('facebook_post','social','facebook_page',
 'Storm season is almost over. Here''s what the best contractors are doing right now.',
 'The actions taken in August determine your starting position next spring.',
 E'What the top contractors are doing in mid-August:\n\n✅ Closing their supplement backlog — every open claim, submitted\n✅ Requesting RCV release on all completed H1 jobs — the 180-day clock is running\n✅ Sending review requests to every completed job since May — while it''s still fresh\n✅ Starting the fall inspection campaign — September emails, October installs, November revenue\n✅ Building their 2027 review base — target: 50+ Google reviews before next April\n✅ Documenting their storm response process — what worked, what didn''t\n\nThe contractors who win next spring are building the pipeline right now.\n\nRoofing OS helps you do all of it in one place.\n\nroofingos.dev?ref=fb →',
 'pending_approval','business_ops','2026-08-19');
