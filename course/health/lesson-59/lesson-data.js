window.AMG_LESSON = {
  "number": 59,
  "id": "59",
  "version": 1,
  "title": "Mixed cases: plans, claims and disability",
  "subtitle": "Six client situations that each cross several lessons. Practice finding the rule before touching the numbers.",
  "outline": [
    "6.2",
    "4.1",
    "5.2",
    "7.4"
  ],
  "objectives": [
    "Compute cost sharing and disability benefits from facts that mix several provisions.",
    "Apply the claim clocks and group continuation rules to a single family’s year.",
    "Choose the plan design that fits a described client."
  ],
  "sources": [
    {
      "title": "HealthCare.gov glossary",
      "url": "https://www.healthcare.gov/glossary/"
    },
    {
      "title": "Insurance Article §15–409, Maryland continuation",
      "url": "https://mgaleg.maryland.gov/mgawebsite/laws/StatuteText?article=gin&section=15-409"
    },
    {
      "title": "NAIC Uniform Individual Accident and Sickness Policy Provision Law",
      "url": "https://content.naic.org/model-laws"
    }
  ],
  "blocks": [
    {
      "title": "Case one: the hospital bill",
      "narration": "Marcus’s PPO has a 1,500 dollar deductible, 80 percent in-network coinsurance, 60 percent out of network and a 5,000 dollar out-of-pocket maximum. He is admitted to an in-network hospital with allowed charges of 28,000 dollars. Work it in order. Deductible first: 1,500. Coinsurance second: 20 percent of the remaining 26,500 is 5,300. Cap last: his total of 6,800 exceeds the 5,000 maximum, so he pays 5,000 and the plan pays 23,000. If the same stay had been out of network, the lower benefit level and any balance bill would apply, and the surprise billing rules might protect him only for emergency care.",
      "visual": {
        "type": "calculation",
        "items": [
          [
            "$1,500",
            "Deductible"
          ],
          [
            "$5,300",
            "20% of $26,500"
          ],
          [
            "$5,000",
            "Out-of-pocket maximum caps him"
          ],
          [
            "$23,000",
            "Plan pays"
          ]
        ]
      },
      "topics": [
        "6.2.02",
        "6.2.03",
        "6.2.04",
        "6.2.11"
      ]
    },
    {
      "title": "Case two: the missed premium",
      "narration": "Rosa pays her disability premium quarterly. The premium due April 1 is not paid. Her policy allows the 31-day grace period that applies to quarterly premiums, so she is covered through May 1. On April 20 she is injured. The claim is covered, less the overdue premium. She must give notice within 20 days of the loss, the insurer must send claim forms within 15 days, and she must furnish proof of loss within 90 days. Had the injury come on May 15 after a lapse, she would need reinstatement, and a sickness beginning within ten days of reinstatement would not be covered.",
      "visual": {
        "type": "flow",
        "items": [
          [
            "April 1",
            "Premium due; 31-day grace for quarterly"
          ],
          [
            "April 20",
            "Injury within grace; covered"
          ],
          [
            "20, 15, 90",
            "Notice, forms, proof"
          ]
        ]
      },
      "topics": [
        "4.1.03",
        "4.1.04",
        "4.1.05",
        "4.1.06",
        "4.1.07"
      ]
    },
    {
      "title": "Case three: the partial return",
      "narration": "Rosa’s policy pays 3,600 dollars a month after a 90-day elimination period, with a residual benefit and a social insurance supplement of 1,200 dollars. She is totally disabled on June 1. Benefits accrue from August 30 and the first check arrives at the end of September. In month ten Social Security approves her for 1,500 dollars a month, so the supplement stops. In month fourteen she returns half time with a 40 percent income loss; her residual benefit is 40 percent of 3,600, which is 1,440, and her waiver of premium continues as long as she remains disabled under the policy.",
      "visual": {
        "type": "calculation",
        "items": [
          [
            "Day 90",
            "Elimination ends"
          ],
          [
            "$3,600 + $1,200",
            "Until Social Security pays"
          ],
          [
            "$1,440",
            "Residual at 40% income loss"
          ]
        ]
      },
      "topics": [
        "5.2.02",
        "5.2.05",
        "5.2.07",
        "5.2.03"
      ]
    },
    {
      "title": "Case four: the layoff",
      "narration": "Elena’s coworker at a 12-employee clinic is laid off on March 31 after two years of coverage. COBRA does not apply, because the employer has fewer than 20 employees. Maryland continuation does: she had more than three months of coverage and lost her job for a reason other than cause, so she may elect within 45 days to continue the group plan for up to 18 months at the employer-plus-employee premium plus an approved fee. She may also convert to an individual policy within 31 days, or use a 60-day special enrollment period on Maryland Health Connection, where a premium tax credit may make a marketplace plan cheaper than continuation.",
      "visual": {
        "type": "cards",
        "items": [
          [
            "COBRA",
            "Does not apply under 20 employees"
          ],
          [
            "Maryland continuation",
            "45 days to elect; 18 months"
          ],
          [
            "Alternatives",
            "Conversion within 31 days; Exchange within 60 days"
          ]
        ]
      },
      "topics": [
        "7.4.10",
        "7.4.11",
        "7.4.12"
      ]
    },
    {
      "title": "Case five: two plans, one child",
      "narration": "Marcus, born in September, and Elena, born in March, both carry family coverage. Their son’s allowed charges are 6,000 dollars. Elena’s plan is primary under the birthday rule and pays 4,200 after its deductible and coinsurance. Marcus’s plan is secondary and would have paid 4,800 alone, so it pays the 1,800 balance and the family owes nothing. In July Marcus’s employer changes carriers; a deductible carryover credits what he already paid, and no-loss no-gain keeps his son’s ongoing orthopedic treatment covered. In November Elena’s hours drop below the eligible class, triggering her own continuation rights.",
      "visual": {
        "type": "calculation",
        "items": [
          [
            "Primary",
            "Elena’s plan, earlier birthday: $4,200"
          ],
          [
            "Secondary",
            "Marcus’s plan pays the $1,800 balance"
          ],
          [
            "Carrier change",
            "Carryover; no-loss no-gain"
          ]
        ]
      },
      "topics": [
        "7.4.04",
        "7.4.05",
        "7.4.06",
        "7.4.07"
      ]
    },
    {
      "title": "Case six: choosing the plan",
      "narration": "Three clients, three designs. Priya’s younger employees want the lowest premium and accept a network and referrals: an HMO. Marcus wants to keep a specialist outside any network and will pay more: a PPO. Rosa wants HMO pricing most of the time with the option to go outside when it matters: a point-of-service plan. For each, the questions are the same. Is a referral required? Is there any out-of-network benefit? Are copayments or coinsurance used? Add the Lesson 19 arithmetic and the Lesson 23 coordination rules, and most plan questions on the exam become a matter of reading carefully and working in order.",
      "visual": {
        "type": "recap",
        "items": [
          [
            "HMO",
            "Lowest cost; referrals; network only"
          ],
          [
            "PPO",
            "Choice; two benefit levels"
          ],
          [
            "POS",
            "Gatekeeper inside; coverage outside"
          ],
          [
            "Method",
            "Rule first, then numbers"
          ]
        ]
      },
      "topics": [
        "6.2.09",
        "6.2.11",
        "6.2.12"
      ]
    }
  ],
  "notes": [
    {
      "title": "Order of operations for cost sharing",
      "text": "Always apply the deductible, then coinsurance on the remainder, then compare the insured’s total to the out-of-pocket maximum. Copayments usually bypass the deductible but count toward the maximum. Premiums never count.",
      "example": "A $500 copayment-based plan with a $3,000 maximum: the insured pays copayments until they total $3,000, then nothing more for covered in-network care.",
      "topics": [
        "6.2.02",
        "6.2.03",
        "6.2.04"
      ]
    },
    {
      "title": "Reading a group termination question",
      "text": "Identify the employer size, the reason coverage ended, how long the person was covered and the state. Then pick the right door: COBRA, Maryland continuation, conversion or Exchange special enrollment, remembering that more than one may be open at once.",
      "example": "A 25-employee firm’s terminated worker has both COBRA and Maryland continuation rights; the more favorable terms apply.",
      "topics": [
        "7.4.10",
        "7.4.11",
        "7.4.12"
      ]
    }
  ],
  "questions": [
    {
      "id": "H59-01",
      "prompt": "A plan has a $1,500 deductible, 80 percent in-network coinsurance and a $5,000 out-of-pocket maximum. On $28,000 of in-network allowed charges the insured pays:",
      "options": [
        "$1,500",
        "$5,000",
        "$6,800",
        "$7,100"
      ],
      "answer": 1,
      "explanations": [
        "The deductible is only the first layer.",
        "The $1,500 deductible plus $5,300 of coinsurance totals $6,800, but the $5,000 maximum caps the insured’s share.",
        "$6,800 ignores the out-of-pocket maximum.",
        "$7,100 overstates the coinsurance."
      ],
      "topics": [
        "6.2.02",
        "6.2.03",
        "6.2.04"
      ],
      "review": 0
    },
    {
      "id": "H59-02",
      "prompt": "A quarterly premium due April 1 goes unpaid. The insured is injured April 20. Under the uniform grace period provision the claim is:",
      "options": [
        "Denied because the premium was unpaid",
        "Covered, because the 31-day grace period for quarterly premiums had not expired",
        "Covered only if the premium is paid by April 21",
        "Denied until reinstatement"
      ],
      "answer": 1,
      "explanations": [
        "Coverage continues during the grace period.",
        "Quarterly and other non-monthly premiums carry a 31-day grace period, so April 20 falls within it.",
        "The grace period runs through May 1, not April 21.",
        "No lapse occurred, so reinstatement is unnecessary."
      ],
      "topics": [
        "4.1.03"
      ],
      "review": 1
    },
    {
      "id": "H59-03",
      "prompt": "An insured gives notice of claim on day 10 and the insurer sends no claim forms by day 30. The insured may:",
      "options": [
        "Wait indefinitely for forms",
        "Submit written proof of loss in any form describing the occurrence and extent of the loss",
        "Sue immediately",
        "Forfeit the claim"
      ],
      "answer": 1,
      "explanations": [
        "Waiting is unnecessary.",
        "When forms are not supplied within 15 days of notice, any written proof is acceptable.",
        "Suit may not be filed until 60 days after proof of loss.",
        "Insurer delay does not forfeit the claim."
      ],
      "topics": [
        "4.1.06",
        "4.1.07"
      ],
      "review": 1
    },
    {
      "id": "H59-04",
      "prompt": "A disability policy with a 90-day elimination period and benefits paid monthly in arrears covers an insured totally disabled on June 1. Her first benefit check arrives about:",
      "options": [
        "June 1",
        "August 30",
        "Late September",
        "Late December"
      ],
      "answer": 2,
      "explanations": [
        "Benefits never begin on the first day.",
        "August 30 is when benefits begin to accrue, not when the first check arrives.",
        "The first month of benefits accrues through late September and is paid then.",
        "December is far too late."
      ],
      "topics": [
        "5.2.02"
      ],
      "review": 2
    },
    {
      "id": "H59-05",
      "prompt": "A disabled insured with a $3,600 total benefit and a $1,200 social insurance supplement is approved for $1,500 a month from Social Security. Her private benefits become:",
      "options": [
        "$4,800",
        "$3,600",
        "$2,100",
        "$3,300"
      ],
      "answer": 1,
      "explanations": [
        "$4,800 was her total before Social Security paid.",
        "The supplement is offset by the $1,500 Social Security benefit, leaving the $3,600 base benefit, which individual policies do not reduce.",
        "$2,100 would wrongly offset the base benefit.",
        "$3,300 does not reflect the correct offset of the supplement."
      ],
      "topics": [
        "5.2.05"
      ],
      "review": 2
    },
    {
      "id": "H59-06",
      "prompt": "Rosa returns to work half time with a 40 percent income loss under a policy paying $3,600 for total disability with a residual benefit. Her monthly residual benefit is:",
      "options": [
        "$1,800",
        "$1,440",
        "$2,160",
        "$3,600"
      ],
      "answer": 1,
      "explanations": [
        "$1,800 is a flat 50 percent partial benefit, not residual.",
        "Forty percent of $3,600 equals $1,440.",
        "$2,160 applies the wrong percentage.",
        "Full benefits require total disability."
      ],
      "topics": [
        "5.2.07"
      ],
      "review": 2
    },
    {
      "id": "H59-07",
      "prompt": "A 12-employee Maryland employer lays off a worker covered for two years. Which continuation right applies?",
      "options": [
        "COBRA for 18 months",
        "Maryland continuation for up to 18 months, elected within 45 days",
        "No continuation right",
        "COBRA for 36 months"
      ],
      "answer": 1,
      "explanations": [
        "COBRA requires 20 or more employees.",
        "Maryland continuation applies to employers of any size after loss of employment not for cause.",
        "Maryland law provides the right.",
        "Thirty-six months is a COBRA period for dependent events at larger employers."
      ],
      "topics": [
        "7.4.10"
      ],
      "review": 3
    },
    {
      "id": "H59-08",
      "prompt": "A laid-off worker wants to buy an individual policy from her group insurer without a medical exam. She must apply within:",
      "options": [
        "10 days",
        "31 days",
        "45 days",
        "90 days"
      ],
      "answer": 1,
      "explanations": [
        "Ten days is a free-look period.",
        "The conversion privilege generally requires application within 31 days of termination.",
        "Forty-five days is the Maryland continuation election period.",
        "Ninety days is a waiting period maximum."
      ],
      "topics": [
        "7.4.11"
      ],
      "review": 3
    },
    {
      "id": "H59-09",
      "prompt": "Elena’s plan, primary under the birthday rule, pays $4,200 of a $6,000 allowed claim. Marcus’s secondary plan would have paid $4,800 alone. The secondary plan pays:",
      "options": [
        "$4,800",
        "$1,800",
        "$600",
        "$0"
      ],
      "answer": 1,
      "explanations": [
        "The secondary plan pays only the remaining allowable expense.",
        "The $1,800 balance brings total payment to 100 percent of the allowed charge.",
        "$600 is not derived from the facts.",
        "The secondary plan owes the balance up to its own benefit."
      ],
      "topics": [
        "7.4.04"
      ],
      "review": 4
    },
    {
      "id": "H59-10",
      "prompt": "A client wants HMO-level premiums with the option to see out-of-network providers at a higher cost when she chooses. The design that fits is a(n):",
      "options": [
        "Exclusive provider organization",
        "Point-of-service plan",
        "Indemnity plan",
        "Hospital indemnity policy"
      ],
      "answer": 1,
      "explanations": [
        "EPOs provide no out-of-network benefits.",
        "A POS plan combines an HMO structure with out-of-network coverage at higher cost sharing.",
        "Indemnity plans lack HMO-level pricing.",
        "Hospital indemnity is a limited policy, not a medical plan design."
      ],
      "topics": [
        "6.2.12"
      ],
      "review": 5
    }
  ],
  "key": "amg-health-lesson-59-v1",
  "track": "health",
  "video": "/course/health/videos/health-59.mp4",
  "poster": "/course/health/videos/health-59.png",
  "duration": 300,
  "pending": false,
  "transcript": "Marcus’s PPO has a 1,500 dollar deductible, 80 percent in-network coinsurance, 60 percent out of network and a 5,000 dollar out-of-pocket maximum. He is admitted to an in-network hospital with allowed charges of 28,000 dollars. Work it in order. Deductible first: 1,500. Coinsurance second: 20 percent of the remaining 26,500 is 5,300. Cap last: his total of 6,800 exceeds the 5,000 maximum, so he pays 5,000 and the plan pays 23,000. If the same stay had been out of network, the lower benefit level and any balance bill would apply, and the surprise billing rules might protect him only for emergency care.\n\nRosa pays her disability premium quarterly. The premium due April 1 is not paid. Her policy allows the 31-day grace period that applies to quarterly premiums, so she is covered through May 1. On April 20 she is injured. The claim is covered, less the overdue premium. She must give notice within 20 days of the loss, the insurer must send claim forms within 15 days, and she must furnish proof of loss within 90 days. Had the injury come on May 15 after a lapse, she would need reinstatement, and a sickness beginning within ten days of reinstatement would not be covered.\n\nRosa’s policy pays 3,600 dollars a month after a 90-day elimination period, with a residual benefit and a social insurance supplement of 1,200 dollars. She is totally disabled on June 1. Benefits accrue from August 30 and the first check arrives at the end of September. In month ten Social Security approves her for 1,500 dollars a month, so the supplement stops. In month fourteen she returns half time with a 40 percent income loss; her residual benefit is 40 percent of 3,600, which is 1,440, and her waiver of premium continues as long as she remains disabled under the policy.\n\nElena’s coworker at a 12-employee clinic is laid off on March 31 after two years of coverage. COBRA does not apply, because the employer has fewer than 20 employees. Maryland continuation does: she had more than three months of coverage and lost her job for a reason other than cause, so she may elect within 45 days to continue the group plan for up to 18 months at the employer-plus-employee premium plus an approved fee. She may also convert to an individual policy within 31 days, or use a 60-day special enrollment period on Maryland Health Connection, where a premium tax credit may make a marketplace plan cheaper than continuation.\n\nMarcus, born in September, and Elena, born in March, both carry family coverage. Their son’s allowed charges are 6,000 dollars. Elena’s plan is primary under the birthday rule and pays 4,200 after its deductible and coinsurance. Marcus’s plan is secondary and would have paid 4,800 alone, so it pays the 1,800 balance and the family owes nothing. In July Marcus’s employer changes carriers; a deductible carryover credits what he already paid, and no-loss no-gain keeps his son’s ongoing orthopedic treatment covered. In November Elena’s hours drop below the eligible class, triggering her own continuation rights.\n\nThree clients, three designs. Priya’s younger employees want the lowest premium and accept a network and referrals: an HMO. Marcus wants to keep a specialist outside any network and will pay more: a PPO. Rosa wants HMO pricing most of the time with the option to go outside when it matters: a point-of-service plan. For each, the questions are the same. Is a referral required? Is there any out-of-network benefit? Are copayments or coinsurance used? Add the Lesson 19 arithmetic and the Lesson 23 coordination rules, and most plan questions on the exam become a matter of reading carefully and working in order."
};
