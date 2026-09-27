// Generated from DOCS/user/*.md by npm run docs:generate. Do not edit.
import type { HelpSection } from './help-content';

export const HELP_SECTIONS: HelpSection[] = [
  {
    "id": "overview",
    "label": "Overview",
    "title": "Alpha Edge",
    "body": "Alpha Edge brings portfolio holdings, research, market evidence, signals and alert connections into one working view. Each page owns a distinct part of that decision flow.",
    "blocks": [
      {
        "type": "heading",
        "text": "Guided Tour",
        "id": "guided-tour"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The first visit to Positions offers a welcome and an optional guided tour.\nChoose "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Show me around"
              }
            ]
          },
          {
            "type": "text",
            "text": " to follow Portfolio, Analysis, Positions, Alerts,\nMarkets, System and History. The guide sits above the workspace so the actual\npages remain available. You can move backwards, close it, or explore another\npage at any time. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Help > Guided tour"
              }
            ]
          },
          {
            "type": "text",
            "text": " opens it again."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Skipping, starting or completing the tour suppresses the welcome on later visits\nin that browser. Demo and private modes remember this separately. Direct links\nto other pages are not interrupted. The guide only navigates: it never changes\ntargets, confirms subscriptions, starts paid research or records an execution."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Access",
        "id": "access"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "On a private deployment with owner sessions enabled, sign in using your passkey.\nThe shield in the header lets you add a backup passkey or sign out. Save the\noffline recovery codes shown at enrollment; each can register a replacement\npasskey once. Recovery replaces old access and issues new codes. Do not share\nthese codes or the private setup token."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The separate public "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Demo"
              }
            ]
          },
          {
            "type": "text",
            "text": " uses real ASX names with simulated portfolio data and cannot record trades, change\ntargets, import statements or run paid research. Your real portfolio is not part\nof that demonstration. Older deployments may still use the API-token prompt\nuntil their owner-access migration is completed."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Start With What You Own",
        "id": "start-with-what-you-own"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Connect the private application to its backend and import a complete supported broker statement. Signing in authorises access; it does not create holdings. External holdings from another broker remain manually maintained and are not verified by an IG statement."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Review "
          },
          {
            "type": "link",
            "href": "#/help/positions",
            "children": [
              {
                "type": "text",
                "text": "Positions"
              }
            ]
          },
          {
            "type": "text",
            "text": " for current holdings, "
          },
          {
            "type": "link",
            "href": "#/help/portfolio",
            "children": [
              {
                "type": "text",
                "text": "Portfolio"
              }
            ]
          },
          {
            "type": "text",
            "text": " for the approved asset-class mix and "
          },
          {
            "type": "link",
            "href": "#/help/alerts",
            "children": [
              {
                "type": "text",
                "text": "Alerts"
              }
            ]
          },
          {
            "type": "text",
            "text": " for TradingView setup. A watchlist item is research, not a holding."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Three Different States",
        "id": "three-different-states"
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Held:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the broker evidence for what is currently owned."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Approved:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the class allocation you have agreed to implement."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Permitted now:"
                }
              ]
            },
            {
              "type": "text",
              "text": " what current risk, trend, class capacity and cash rules allow."
            }
          ]
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Research suggestions can change without changing your approved shape. A new signal can change permitted action without proving a trade happened. You place orders at your broker and then record the execution in Alpha Edge."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Find The Right Surface",
        "id": "find-the-right-surface"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The Alert Stack is for current work requiring a response. The Alerts tab is the connection ledger. History retains past signals, responses and statement evidence. The right sidebar provides optional security, ETF and shape context; it is not another approval queue."
          }
        ]
      },
      {
        "type": "heading",
        "text": "When Something Is Missing",
        "id": "when-something-is-missing"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Check the source date, connection setup and backend availability. Blank or unavailable data is not zero, a neutral trend or a completed trade. Do not repeat an execution entry or a paid AI submission simply because a result has not appeared."
          }
        ]
      }
    ]
  },
  {
    "id": "positions",
    "label": "Positions",
    "title": "Current positions",
    "body": "Positions shows holdings already in the portfolio, their current exposure, active action state and the evidence supporting a decision to add, reduce or exit.",
    "blocks": [
      {
        "type": "heading",
        "text": "Read The Class Before The Security",
        "id": "read-the-class-before-the-security"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Asset-class rows summarise their holdings and compare actual allocation with the approved shape. Compare views and compact numbers are views of the same class allocation, not competing targets."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Held Core ETFs stay pinned at the top of their class. Their ratio chip is read-only here. Double-click a security to open its details in the right sidebar; use its research and performance links to investigate further."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Once updated holdings confirm a full exit, Normal Positions hides that security.\nA class disappears when none of its securities remain held; empty parent groups\ndisappear too. Selling one security does not hide other holdings in the class.\nZero-valued securities with remaining units are still shown. Recording a sale or\nreceiving a Sell signal alone does not change the holdings display."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "This only filters the Positions view. Saved groups, class settings, research,\napproved targets and historical records are not deleted, and the group returns\nwhen holdings are added again. Actions and portfolio reconciliation retain their\nclass evidence. Any remaining cash continues to be accounted for separately."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Ideal Weight",
        "id": "ideal-weight"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Ideal wt"
              }
            ]
          },
          {
            "type": "text",
            "text": ", beside Class %, shows a modelled allocation across the stocks you\ncurrently hold in each asset class. It uses the same research scoring engine as\nAnalysis, but not its watchlist or IN/OUT selection. Confirmed entries and exits\nupdate the calculation automatically. Analysis remains unchanged."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The number is a percentage of the whole approved class budget. Stocks divide the\nbudget remaining after ETF capacity; Core ETF rows show their effective ETF\ntarget. For example, a 25% ETF target leaves 75% for stocks: two stocks with model\nweights of 2:1 show 50% and 25%. If ETFs already occupy more than their target,\nthat occupied capital also reduces stock capacity."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Analysis percentages divide only its selected stock budget. When the stock sets\nmatch, the proportions agree after accounting for the ETF allocation. Different\nstock sets intentionally give different percentages. Neither number moves cash,\ncreates orders, or changes the approved shape or existing adds/trim permissions."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "If any held stock lacks a complete sizing-model result, every stock in that\nasset class shows a dash, not a zero or a partial recommendation. A complete\nresult means Quality, Value and price target from at least one of Gemini,\nPerplexity, GPT or Claude; a usable current price is also required. All four\nmodels are not required. Council alone does not supply the sizing base score.\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Analysis > Data issues > Incomplete sizing research"
              }
            ]
          },
          {
            "type": "text",
            "text": " lists missing model\nresults. Complete the research to restore the class's stock weights automatically.\nUnheld watchlist gaps do not affect Positions; Core ETF targets and complete\nclasses remain available. Analysis IN/OUT does not bypass a held-stock gap.\nUnavailable budgets or sizing results also show a dash; hover for the reason."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Class % and Portfolio % keep their numbers visible, with their background fills\nrevealed across the corresponding column when its header or any cell is hovered\nor contains keyboard focus. These columns no longer need fill checkboxes."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The Ideal wt percentage stays visible. The thin bar represents 0-100% of the whole class\nand appears for the entire column when any Ideal wt cell or its header is hovered\nor contains keyboard focus. Red overstretch bars remain visible even when the\ncolumn is not being inspected. On touch screens,\nthe percentage and red warnings remain available without hover. Hover the\npercentage for its dollar equivalent; unavailable weights show a dash without a bar.\nIts colour compares the displayed Class % with Ideal wt: matching percentages\nare green, below ideal is lighter (darker in light mode), and at least 150% of\nthe ideal percentage for stocks or 125% for Core ETFs is red. Stale references\nstay neutral; incomplete class research shows no bar. This shows the mix of holdings within the class, not\nhow fully the class budget is funded. The separate dollar-based trade rules\nbelow are unchanged: the colours remain advisory, and red alone does not create\na trade alert."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Click the heading to sort; resize, reorder or hide the column using the existing\ncolumn controls. It appears only in Normal Positions, not the Actions workflow."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Optional Weight Management",
        "id": "optional-weight-management"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Open the shield beside "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Ideal wt"
              }
            ]
          },
          {
            "type": "text",
            "text": " to change "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Weight management"
              }
            ]
          },
          {
            "type": "text",
            "text": ".\nIt is optional and "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Off by default"
              }
            ]
          },
          {
            "type": "text",
            "text": ". Off keeps Ideal wt\nvisible without an individual weight limit or weight-based reduction proposals.\nOff also removes the old individual allocation ceiling. Class budgets, cash,\nsignals and Q3/Q4 safeguards still apply. This portfolio setting is shared across\ndevices. The public demonstration is read-only."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "When On, valid new purchases can fill a stock's ideal amount or a Core ETF's\neffective target, but cannot exceed it. Being below target does not itself ask\nyou to buy: a valid signal, class capacity and confirmed cash are still needed.\nResearch keeps updating; you do not have to reselect your holdings after an\nentry or exit."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Existing positions can grow above their target. The agreed reduction rules are:"
          }
        ]
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Stocks:"
                }
              ]
            },
            {
              "type": "text",
              "text": " at least 150% of the ideal amount prompts a proposed reduction to 125%."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Core ETFs:"
                }
              ]
            },
            {
              "type": "text",
              "text": " at least 125% of the effective target prompts a proposed reduction to 100%."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Confirmation:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the excess must qualify on two consecutive daily valuation observations with different dates and fresh data. Refreshes and corrections to the same date do not count twice."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Minimum size:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the proposed reduction must be at least the greater of A$100 or 0.25% of portfolio value. Smaller differences do not create trade alerts."
            }
          ]
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "For a $50,000 portfolio, that minimum is $125. A stock with a $1,000 ideal and\n$1,500 held would propose a $250 reduction, leaving $1,250. A Core ETF with a\n$1,000 target and $1,250 held would propose a $250 reduction, leaving $1,000.\nThese percentages measure target coverage, not profit or loss."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Comparing Actual And Ideal",
        "id": "comparing-actual-and-ideal"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Class % shows the share of the group's currently invested value. Ideal wt shows\nthe modelled share of the approved class budget. They are useful side by side,\nbut their difference is not automatically a buy or sell amount."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "For example, a $10,000 approved class with $8,000 invested could contain a\n$2,000 stock. It shows 25% Class % but already meets a 20% ($2,000) ideal. Weight\nmanagement compares holding dollars and ideal dollars using consistent\nvaluations, rather than subtracting those displayed percentages."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Reviewing Weight Reductions",
        "id": "reviewing-weight-reductions"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The workflow creates a proposal for your review, never an automatic\norder. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Reduce $X"
              }
            ]
          },
          {
            "type": "text",
            "text": " opens the existing action detail with holding, ideal,\nreduction, remaining amount, valuation date and rule. Differences can arise from\nprices, research, the class budget or ETF capacity; the proposal does not claim\nto identify a single cause. A missing or zero model target is\nnot an automatic Exit. A non-Core ETF without a target is not automatically sold."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Only one weight proposal per security is outstanding. Existing signal\nreductions, risk actions and trades awaiting statements take precedence to avoid\nduplicate sales. After execution is recorded, a later broker statement must\nconfirm the quantity change. Released cash still needs the existing cash-source\nvalidation/allocation workflow; neither estimated sale proceeds nor a unit match\nautomatically credits a class reserve or finances another purchase."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Buy/Add alerts remain visible as "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Add paused"
              }
            ]
          },
          {
            "type": "text",
            "text": " when weight limits or missing\nevidence prevent adding. Open the alert for the reason. Partially funded Adds\nshow the permitted amount. Already-executed purchases can still be recorded\nthrough the existing purchase-exception option with units, AUD spent and a reason."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Dismissed weight proposals do not return on every refresh: the holding must\nfirst register a fresh below-threshold day, then two new qualifying days.\nLarge class differences show a small review marker beside the class in Portfolio,\nnot another set of stock trade cards."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Switching Off cancels unexecuted weight proposals with a reason in History.\nIt does not undo recorded\ntrades, clear statement waits or disable independent signal and risk actions.\nThe thresholds are agreed starting hypotheses, not a promise that a\nparticular portfolio weight is financially optimal."
          }
        ]
      },
      {
        "type": "heading",
        "text": "View Options",
        "id": "view-options"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The sliders button opens "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Position view options"
              }
            ]
          },
          {
            "type": "text",
            "text": ". Asset-class order keeps the\nsaved order or sorts by target percentage, current percentage or absolute drift.\nClick the selected percentage/drift option again to reverse its direction.\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Peek / Fixed"
              }
            ]
          },
          {
            "type": "text",
            "text": " selects row behaviour; "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Visible rows"
              }
            ]
          },
          {
            "type": "text",
            "text": " controls the existing\nsummary and value displays. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Groups"
              }
            ]
          },
          {
            "type": "text",
            "text": " opens the group manager. Expand/collapse\nall remains a separate button beside the menu. Escape closes the menu and returns\nkeyboard focus to the sliders button."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Drag the right edge of a column heading to resize that column. Other columns keep\ntheir widths; scroll horizontally when the table no longer fits. Drag the heading\nitself to reorder columns, or click its label to sort."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Double-click an edge to reset that column. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Reset column widths"
              }
            ]
          },
          {
            "type": "text",
            "text": " in the Name\ncolumn's menu restores automatic sizing for the current mode. Widths are saved in\nthis browser, separately for Normal, Actions and phone layouts. Keyboard users can\nfocus a column edge and press Left/Right for 10px steps, or Shift+Left/Right for 1px.\nEscape cancels an unfinished drag."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Portfolio Actions",
        "id": "portfolio-actions"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Actions"
              }
            ]
          },
          {
            "type": "text",
            "text": " contains portfolio-level workflows such as a Q3/Q4 reduction or an\napproved target rebalance. Choose the workflow at the top of the panel. This is\nseparate from a security's Buy, Reduce or Exit instruction in the normal table."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The three stages are "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Adjust positions"
              }
            ]
          },
          {
            "type": "text",
            "text": ", "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Check statement"
              }
            ]
          },
          {
            "type": "text",
            "text": " and "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Complete"
              }
            ]
          },
          {
            "type": "text",
            "text": ".\nThe highlighted stage and the current-task heading explain what needs attention."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "For a Q3 reduction, the heading states "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Reduce Q1 by X%"
              }
            ]
          },
          {
            "type": "text",
            "text": ", using the backend's\nsignal adjustment ratio. The exposure target underneath is the retained level,\nnot the reduction: moving from 100% to 49% means reducing by 51%. The dollar\nrequirement remains in the totals below, including any applicable defensive-class\nadjustments. These percentages are not percentages of the whole portfolio."
          }
        ]
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "text",
              "text": "During adjustment, "
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Required / guide"
                }
              ]
            },
            {
              "type": "text",
              "text": " is the required reduction for an asset\nclass and proportional guidance for a stock. It is not the final holding target.\nRecord the reduction actually executed. The "
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Remaining"
                }
              ]
            },
            {
              "type": "text",
              "text": " column belongs to\nthe class requirement, not a binding per-stock target. Optional percentage and\nreference columns are available from the column menu without changing Normal."
            }
          ],
          [
            {
              "type": "text",
              "text": "Review the totals before confirming. Going back preserves the entered amounts\nand your expanded/collapsed rows. Saving a draft is not execution confirmation."
            }
          ],
          [
            {
              "type": "text",
              "text": "Once execution is recorded, the inputs are locked. Where available, the table\nshows "
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Expected"
                }
              ]
            },
            {
              "type": "text",
              "text": ", "
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Statement"
                }
              ]
            },
            {
              "type": "text",
              "text": " and "
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Difference"
                }
              ]
            },
            {
              "type": "text",
              "text": " from reconciliation evidence.\nOtherwise it shows the latest statement holdings, not invented stock-level\nexecution records or zeros that imply the trades need repeating."
            }
          ],
          [
            {
              "type": "text",
              "text": "Portfolio rebalance differences can be expanded by asset class. Recorded\nreductions, the remaining amount and any recording tolerance are distinct\nfrom statement verification. Approval stays unavailable until the existing\nstatement checks pass. Reopening a risk adjustment requires confirmation."
            }
          ]
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "On compact workspaces the workflow and its next action appear before the table.\nOn wide workspaces the workflow sits beside it. Neither arrangement automatically\nchanges the Alert Stack or right-sidebar visibility. No Analysis suggestion is\nmade binding by this view, and expected cash is not verified spending capacity."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Simple View",
        "id": "simple-view"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The grid icon beside Normal and Actions switches to "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Simple view"
              }
            ]
          },
          {
            "type": "text",
            "text": ", a capital\nmap of the same holdings as the Positions table. The table icon returns to the\nexisting rows. Your choice is remembered in this browser; Actions keeps its\nexisting table workflow."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Inside Simple view, "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "2D"
              }
            ]
          },
          {
            "type": "text",
            "text": " retains the tiled map; "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "1D"
              }
            ]
          },
          {
            "type": "text",
            "text": " switches to stacked,\nfull-width rows like the ETF Monitor's capital map. The layout choice is also\nremembered in this browser. Switching layouts keeps your class focus and search."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "In 2D, each tile's area represents the security's actual held value in AUD. Holdings\nare grouped by asset class and use the shared class colours, including your\ncolour overrides. Held ETFs remain within their classes. These colours identify\nclasses, not gains, losses, signals or purchase recommendations."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "In 1D, each holding's fraction of the displayed invested capital determines its\nrow height against the available chart height, with no minimum height or gaps\ninflating small allocations. A holding with 0.5% of the displayed capital occupies\n0.5% of the chart height at "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "1x"
              }
            ]
          },
          {
            "type": "text",
            "text": ". The scale slider enlarges the map up to "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "2x"
              }
            ]
          },
          {
            "type": "text",
            "text": ",\nwith scrolling inside the chart. All holdings grow by the same factor, so larger\nholdings also become taller. The scale stays selected while switching between\n1D and 2D during the current visit; it starts at 1x when the view is reopened.\nThe text icon toggles clipped row labels. When enabled, text stays rendered and\nclips at each row's boundaries. When disabled, labels appear only where they fit.\nNeither choice makes small rows taller. Hover, keyboard focus or search reveals full details below the map.\nSearch also scrolls to a holding at the enlarged scale. Very small holdings may\noccupy less than a screen pixel but remain searchable.\nThe displayed dollar values and percentages retain their usual rounding.\nThe left axis shows cumulative allocation from top to bottom as a percentage of\nthe whole portfolio, including cash. Its usual markers are 25%, 50% and 75%; they\nmove with the map when zooming or scrolling. Focusing on a class uses smaller\nintervals without changing the denominator. The bottom is the displayed holdings'\nshare, not an assumed 100%. No axis is shown if the portfolio total is unavailable.\nUnlike the ETF Monitor's\ntarget-aware map, Positions sizes both views from held capital only."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The map fills its available space with positive-value holdings. Cash is not a\ntile. Percentages shown on tiles and rows use the "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "whole portfolio\nvalue"
              }
            ]
          },
          {
            "type": "text",
            "text": ", including cash, just like the Positions stock rows. The heading states\nhow much of the portfolio the map covers. The details below the map also show\nthe holding's share of its invested asset class; this is not its approved target."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Hover or focus a holding, then click its class in the details below the map to\nfocus on that class. Use the back arrow to return to all classes. There is no\nseparate class legend above the map. Focusing enlarges tiles without changing\ntheir values or portfolio percentages. Search highlights matching names, tickers\nor classes without changing tile sizes; the matching-holding arrows also locate\nvery small positions. In 1D, search also brings the matching row into view.\nHover or keyboard focus reveals full details below the map.\nThe bottom bar also shows the selected holding's broker-reported "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "P/L %"
              }
            ]
          },
          {
            "type": "text",
            "text": " and\nthe same "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Buy / Sell trend"
              }
            ]
          },
          {
            "type": "text",
            "text": " as the Positions table. Gains and Buy are green;\nlosses and Sell are red. Missing evidence is shown as a neutral dash, not zero\nP/L or a default Buy. These fields do not change position sizes.\nThe "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Colour by P/L"
              }
            ]
          },
          {
            "type": "text",
            "text": " chart-icon toggle switches both map layouts from asset-class\ncolours to a performance heatmap. Losses become progressively deeper red and gains\nstronger green, on a fixed -50% to +50% scale. Each direction keeps a fixed hue;\nonly saturation and lightness change with magnitude.\nBeyond those endpoints the colour\nstays saturated; the exact P/L remains in the holding details and hover text.\nZero and unavailable P/L use the active theme background, with missing data still shown as a\ndash in the details. This uses broker-reported holding P/L, not daily returns or\nBuy/Sell trend. It changes neither capital sizes nor ordering. Click the toggle\nagain to restore class colours; the choice is remembered in this browser.\nClick a tile, or press Enter on it or a search result, to open the existing\nSecurity sidebar."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Zero, negative and unavailable values are listed separately below the map rather\nthan assigned misleading tile areas. Watchlist and external holdings follow the\nsame inclusion rules as the current Positions table. Simple view does not change\ntargets, sizing, signals, broker values or any execution workflow."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Row Appearance",
        "id": "row-appearance"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Each class starts with a triangle beside its name: down when expanded, right\nwhen collapsed. Click the name, triangle or chosen icon to expand or collapse\nthe class. Hover over the triangle or icon for 800ms: it becomes a pencil.\nClick the pencil to open the icon and colour picker. Moving away restores normal\nexpand/collapse behaviour. On touchscreens, hold the symbol for 800ms;\nwith keyboard focus on it, press Arrow Down to open the picker.\nA chosen icon replaces the triangle in the same fixed space; "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Default arrow"
              }
            ]
          },
          {
            "type": "text",
            "text": "\nrestores it. Both remain visible without hover, and changing the symbol does\nnot move the class name. The palette applies immediately to that class only.\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Class icon"
              }
            ]
          },
          {
            "type": "text",
            "text": " selects a symbol based on that class. Icon choices never inherit\nglobally. Opening the\npalette does not collapse the class."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The palette has 72 symbols grouped by sector, alongside "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Class icon"
              }
            ]
          },
          {
            "type": "text",
            "text": " and\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Default arrow"
              }
            ]
          },
          {
            "type": "text",
            "text": ". Search by class or subject, such as lithium, nuclear, software or\nhealthcare. Class icon has explicit mappings for the shared class catalogue;\ncustom classes without a known mapping use the Global symbol until you choose\nanother. The scrollable grid keeps the palette within smaller screens."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Click the colour square beside the class name at the top of the icon popup\nto open the shared 30-colour palette. Select a colour, then "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Save"
              }
            ]
          },
          {
            "type": "text",
            "text": ", or\ndouble-click a colour to confirm it. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Cancel"
              }
            ]
          },
          {
            "type": "text",
            "text": " discards the draft; "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Reset"
              }
            ]
          },
          {
            "type": "text",
            "text": "\nrestores that class's default colour without removing its icon. Saved colours\napply consistently to that class throughout the app, including historical charts,\nand are stored on the backend. The icon popup has two previews of the selected\nsymbol: grey ("
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Neutral"
              }
            ]
          },
          {
            "type": "text",
            "text": ") and "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Class colour"
              }
            ]
          },
          {
            "type": "text",
            "text": ", identified by their hover tooltips.\nClick either preview; an outline marks the current choice. Grey is the default.\nColoured icons follow later changes to the class colour. When the default arrow\nis selected, the previews show the arrow in its current expanded/collapsed state."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Icon choices and their colour mode are saved per class in this browser. They affect named class headers in normal Positions, with Compare on\nor off. They do not change Q1 sections, cash summary rows, security rows,\nActions, allocation weights or the appearance of other tabs. Custom image\nuploads are not part of this version.\nThe separate "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Row appearance"
              }
            ]
          },
          {
            "type": "text",
            "text": " menu and border controls have been removed.\nEarlier border, global icon and background preferences are ignored; explicit\nper-class icons and app-wide colour choices are retained. Row backgrounds and\nborders keep the standard table styling."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Responding To An Alert",
        "id": "responding-to-an-alert"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Click a holding's Action cell or the matching Alert Stack item to open the same detail. Record execution only after acting at the broker. Units and an execution note are optional for the ordinary workflow; leaving units blank uses the existing estimated-quantity matching rules."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Pending"
              }
            ]
          },
          {
            "type": "text",
            "text": " means execution is recorded and awaits a later statement. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Check"
              }
            ]
          },
          {
            "type": "text",
            "text": " means the statement did not match. Neither asks you to trade again. Ordinary statement waits and blocked later signals are kept in History instead of repeating as active chips. Later actions remain blocked until the backend resolves the outstanding one."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Purchases And Exits",
        "id": "purchases-and-exits"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Ordinary IG purchases require a funded class ticket. An available purchase-exception control is only for a purchase already executed outside the recommendation: units, AUD spent and a reason are required. External holdings are recorded manually, not verified by IG."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "An Exit cannot be ignored. Retain with reason records an explicit unresolved override. Recording a sale does not itself release spendable cash; confirmation comes from a later validated statement."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Find Previous Responses",
        "id": "find-previous-responses"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Decision history in the Alert Stack opens "
          },
          {
            "type": "link",
            "href": "#/help/history",
            "children": [
              {
                "type": "text",
                "text": "History / Activity"
              }
            ]
          },
          {
            "type": "text",
            "text": ". A Pending cell opens the associated evidence. A system status of Not applicable is not proof of a sale."
          }
        ]
      }
    ]
  },
  {
    "id": "analysis",
    "label": "Analysis",
    "title": "Research ledger",
    "body": "Analysis holds security-level research, watchlist items, Quality, Value, Council evidence, price targets and suggested allocation. Its scores remain live and advisory.",
    "blocks": [
      {
        "type": "heading",
        "text": "Adjust The Table",
        "id": "adjust-the-table"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Drag the right edge of a column heading to resize that column without squeezing\nits neighbours. Widths are saved in this browser and retained when you hide and\nrestore columns, change tabs or reload. Analysis and Positions have separate\nlayouts, as do desktop and mobile."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Double-click a column edge to reset it, or use "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Reset column widths"
              }
            ]
          },
          {
            "type": "text",
            "text": " in the\nName column menu to restore the automatic layout. Press Escape to cancel a drag.\nFocused column edges also support arrow-key adjustments: 10px normally, 1px with\nShift. Sorting, ticker reveal/pinning and the optional notes columns still work\nindependently of resizing."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "In Sector view, class headings share their icons with Positions. Click the\ntriangle or chosen icon to expand or collapse the class. Hover it for 800ms,\nthen click the pencil to choose a different icon. Right-click or focus the icon\nand press Arrow Down to open the same picker; on touchscreens, hold for 800ms.\nThe picker also offers neutral or class-coloured icons and the shared class\ncolour palette. Icon choices are saved in this browser and apply in both tabs;\nchanging one does not change the class's holdings or suggested allocation."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Build A Research Record",
        "id": "build-a-research-record"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Add a watchlist item with its correct exchange and ticker. Assign its asset class and instrument type. Marking a fund as an ETF enables fund-specific behaviour; it does not automatically select it as Core, add it to the momentum engine or establish a TradingView connection."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "A small raised exclamation mark at the top-right of a security name means its\nexchange is missing. Click it to assign the exchange. The existing "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Data issues"
              }
            ]
          },
          {
            "type": "text",
            "text": "\npanel includes missing exchanges alongside failed, stale or incomplete feeds;\nhealthy feeds are omitted, and long provider errors are under "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Details"
              }
            ]
          },
          {
            "type": "text",
            "text": ".\nChoose "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Auto-assign"
              }
            ]
          },
          {
            "type": "text",
            "text": " to fill missing exchanges from existing listing records\nor verified lookups. This covers the missing securities counted in the panel,\nincluding watchlist and external holdings; search and class focus do not narrow\nthe batch. Progress and "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Assignment results"
              }
            ]
          },
          {
            "type": "text",
            "text": " show which listings were assigned\nand why others need review. Existing assignments and tickers are never replaced.\nDual listings, conflicting identities and unavailable providers remain manual\nreviews. Auto-assign does not create alert connections or refresh price history.\nUse "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Review securities"
              }
            ]
          },
          {
            "type": "text",
            "text": " in its missing-exchanges section to filter Analysis.\nSearch and view choices still apply; the missing count is before search and class\nfocus. Use "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Show all securities"
              }
            ]
          },
          {
            "type": "text",
            "text": " in the same panel to clear the filter, or fix\nthe remaining exchanges and the filter clears automatically. Assigned exchanges\nremain accessible through the row's existing hover/edit controls."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Run or refresh research deliberately. A job may take time and can fail. Check its status and existing results before resubmitting an uncertain request, particularly when a paid provider is involved."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Click a security row's non-interactive area, or its Quality/Value score, to expand\nthe research comparison. Model rows align Quality, Value, price target and input\ndate; partial records remain labelled "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Partial"
              }
            ]
          },
          {
            "type": "text",
            "text": ", and missing values are not zeroes.\nClick anywhere on a model row to inspect its run and add or edit its source text.\nThe edit-output and plus icons open the same editor, including from the keyboard.\nCancel and Escape discard unsaved editor changes. The collapse arrow closes the\ncomparison; Escape from inside it also closes it and returns focus to the opener.\nScore buttons support Enter/Space. The panel stays within the visible table width\nwhen columns scroll horizontally. On narrow screens, dates sit beneath model names."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Council"
              }
            ]
          },
          {
            "type": "text",
            "text": " is a separate saved result, not the mean of the four Web UI models;\nthe model-completion count does not describe Council completion. Available\nTradingView, TipRanks and DeerFlow targets appear as additional source rows.\nHover "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Average target"
              }
            ]
          },
          {
            "type": "text",
            "text": " for the sources included in its existing equal-weight\ncalculation. A positive price target can contribute even if that provider's\nQuality/Value record is incomplete. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Suggested weight"
              }
            ]
          },
          {
            "type": "text",
            "text": " remains live advice,\nnot an approved security target. This presentation does not change sizing."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Run Council"
              }
            ]
          },
          {
            "type": "text",
            "text": " and "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Rerun Council"
              }
            ]
          },
          {
            "type": "text",
            "text": " in an expanded security row open the same\nCouncil controls as the table's Council cell. Neither starts an analysis.\nReview source attachments there, then choose Run/Rerun to review the security,\nexchange, template and document. Only "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Confirm and run"
              }
            ]
          },
          {
            "type": "text",
            "text": " submits the job.\nClosing and reopening the controls always resets that confirmation step."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The centered "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Council analysis"
              }
            ]
          },
          {
            "type": "text",
            "text": " dialog opens source preparation from the\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Source research"
              }
            ]
          },
          {
            "type": "text",
            "text": " row beneath the security identity and template. The\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Saved result"
              }
            ]
          },
          {
            "type": "text",
            "text": " remains separate. Quality, Value and Price target remain editable;\nchanges save when you leave the field. The document icon beside "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Saved result"
              }
            ]
          },
          {
            "type": "text",
            "text": "\nopens "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Model output"
              }
            ]
          },
          {
            "type": "text",
            "text": ", including the existing source text and input date.\nClick it again to close the editor. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Load latest"
              }
            ]
          },
          {
            "type": "text",
            "text": ", "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Saved runs"
              }
            ]
          },
          {
            "type": "text",
            "text": " and "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Clear result"
              }
            ]
          },
          {
            "type": "text",
            "text": "\nmanage the saved analysis through the download, history and trash icons beside\nthe result heading, independently of the attachment for the next run.\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Source research"
              }
            ]
          },
          {
            "type": "text",
            "text": " is a view inside this same dialog, not another modal.\nUse the back arrow or Escape to return to Council; "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Done"
              }
            ]
          },
          {
            "type": "text",
            "text": " is also available\nafter attaching sources. The attachment is retained. The close button closes\nthe entire dialog."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Retrieve Research Sources",
        "id": "retrieve-research-sources"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Open a stock's Council controls and choose "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Source research"
              }
            ]
          },
          {
            "type": "text",
            "text": ", then select\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Retrieve automatically"
              }
            ]
          },
          {
            "type": "text",
            "text": " (the left-hand default) or "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Attach your own"
              }
            ]
          },
          {
            "type": "text",
            "text": ". Only\nthe controls for the selected method are shown; switching methods preserves a\npasted draft. Source research uses the same size and position as Council analysis.\nOpening instructions, "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Web UI prompts"
              }
            ]
          },
          {
            "type": "text",
            "text": ", saved research or manual attachments\ndoes not resize the dialog. Long prompts, source results and the paste editor\nscroll inside it. The tabs,\nsource-method choice and bottom action remain visible."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "For automatic retrieval, the small template selector beside the ticker is\npreselected from the asset class; an unmapped class requires a selection.\nReview the template, then choose "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Retrieve sources"
              }
            ]
          },
          {
            "type": "text",
            "text": " at the bottom right\nto start a paid Parallel Ultra 4x retrieval. Selecting the\nautomatic option alone does not make a paid request. The run is saved and\ncontinues if you close the dialog. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Retrieval instructions"
              }
            ]
          },
          {
            "type": "text",
            "text": ", beside the\nattachment status in the footer, reveals the prompt and its copy button when needed."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Saved research"
              }
            ]
          },
          {
            "type": "text",
            "text": " button appears when this security has saved runs. Open it\nto inspect their status, document summaries and evidence gaps within the same\ndialog, then use "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Source options"
              }
            ]
          },
          {
            "type": "text",
            "text": " to return. There is no empty saved-research\nsection. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Ready"
              }
            ]
          },
          {
            "type": "text",
            "text": "\nmeans the source packet passed format and identity checks, not that every fact\nhas been independently verified. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Attach to Council"
              }
            ]
          },
          {
            "type": "text",
            "text": " selects the packet as the\nsupplementary document, replacing any current attachment. It does not start\nCouncil or update scores. Choose "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Done"
              }
            ]
          },
          {
            "type": "text",
            "text": " to return to Council and review the run\nconfirmation when ready."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Already have the evidence? Select "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Attach your own"
              }
            ]
          },
          {
            "type": "text",
            "text": ", then "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Paste"
              }
            ]
          },
          {
            "type": "text",
            "text": " and\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Attach sources"
              }
            ]
          },
          {
            "type": "text",
            "text": ", or "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Upload"
              }
            ]
          },
          {
            "type": "text",
            "text": " a PDF, Markdown, text or JSON document (up to\n20 MB). "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Attach sources"
              }
            ]
          },
          {
            "type": "text",
            "text": ", "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Attach to Council"
              }
            ]
          },
          {
            "type": "text",
            "text": " and the Web UI "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Copy prompt"
              }
            ]
          },
          {
            "type": "text",
            "text": "\naction use that same bottom-right position in their respective views.\nThis is the same single attachment used by retrieved research, not a\nsecond document slot. Replacing it changes the attachment for the next Council\nrun; the remove icon clears it. Manual material is not provider-validated.\nAttaching does not make a paid request. A paperclip beside "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Source research"
              }
            ]
          },
          {
            "type": "text",
            "text": "\nin Council controls indicates an attachment, and the run confirmation names it.\nAttachments survive closing the dialog, but not a full page reload; saved\nParallel results remain available to attach again."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "If submission is uncertain, do not start a replacement. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Check submission"
              }
            ]
          },
          {
            "type": "text",
            "text": "\nreuses the existing request. If the provider accepted a request but its ID was\nlost, "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Recover run"
              }
            ]
          },
          {
            "type": "text",
            "text": " links its existing Parallel run ID after checking it belongs\nto this request. Results marked "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Needs review"
              }
            ]
          },
          {
            "type": "text",
            "text": " can be downloaded but cannot be\nattached as validated packets. A completed run may still have evidence gaps."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The toolbar's "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Template library"
              }
            ]
          },
          {
            "type": "text",
            "text": " remains available for manual work. Choose a\ntemplate once, then switch between "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Source research"
              }
            ]
          },
          {
            "type": "text",
            "text": " instructions and "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Web UI\nprompts"
              }
            ]
          },
          {
            "type": "text",
            "text": " for full external investment analysis. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Copy prompt"
              }
            ]
          },
          {
            "type": "text",
            "text": " copies the selected\ninstructions. Prompts opened from a stock include its name, exchange and ticker;\nthe global library keeps identity placeholders. Neither copying nor opening the\nlibrary makes a paid research call."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Check Monitoring Coverage",
        "id": "check-monitoring-coverage"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The small connection indicator beside each security reports which required\nTradingView alerts are recorded in Alpha Edge. Hover it to see missing setup:"
          }
        ]
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "text",
              "text": "Green: all required connections are recorded."
            }
          ],
          [
            {
              "type": "text",
              "text": "Amber: some are recorded; the tooltip names what is missing."
            }
          ],
          [
            {
              "type": "text",
              "text": "Red: none of the required connections are recorded."
            }
          ],
          [
            {
              "type": "text",
              "text": "Grey: connection data, required configuration or the ETF management profile\nis unavailable, or the ticker/benchmark needs configuration."
            }
          ]
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Stocks require CDF and TMS. Stocks assigned to a configured commodity producer\nclass also require their own Outperform CDF against that class's current equity\nbenchmark. A watchlist stock with only CDF is partially monitored, not fully\nmonitored. Complete the remaining setup in Alerts when appropriate."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "ETFs follow their selected management profile: ETF mode requires ETF TMS; TMS\nmode requires CDF and TMS. ETFs do not require the stock Outperform feed under\neither profile. Core selection alone does not establish any connection."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Green does not mean Buy, permission to purchase, or proof that a feed is fresh.\nA connected Sell signal still has full connection coverage. Positions and the\nETF sidebar use the same coverage rules."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Read A Row",
        "id": "read-a-row"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Columns run from the security to its sizing result: Price and Upside sit beside\nthe name, then Quality, Value and their "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Total"
              }
            ]
          },
          {
            "type": "text",
            "text": ", Council, Signal, Thesis Δ,\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Target WT"
              }
            ]
          },
          {
            "type": "text",
            "text": ", MOM and In/Out."
          }
        ]
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Upside"
                }
              ]
            },
            {
              "type": "text",
              "text": " shows the average price target. Hover it for the upside percentage,\nwhich is what sizing uses: red below 0%, amber below 50% and green at 50% or\nmore."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Total"
                }
              ]
            },
            {
              "type": "text",
              "text": " is the average of Quality and Value across the completed research\nmodels. Council scores and momentum do not change it; momentum and the\nCouncil price target reach only Target Weight."
            }
          ],
          [
            {
              "type": "text",
              "text": "Quality, Value, Total and Council show strong scores (80 or more) in green\nand weak scores (below 50) in red; the middle range stays neutral."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Signal"
                }
              ]
            },
            {
              "type": "text",
              "text": " shows ↑ Buy in green, ↓ Sell in red and → Hold in amber.\n"
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Thesis Δ"
                }
              ]
            },
            {
              "type": "text",
              "text": " is green when positive and red when negative; zero is neutral."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Target WT"
                }
              ]
            },
            {
              "type": "text",
              "text": " shows one value: the security's share of the class. Hover it for\nthe anchored dollar target when class budgets apply."
            }
          ],
          [
            {
              "type": "text",
              "text": "Council shows its source age only when it is older than 90 days."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "In"
                }
              ]
            },
            {
              "type": "text",
              "text": " and "
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Out"
                }
              ]
            },
            {
              "type": "text",
              "text": " are plain text; select them to change sizing participation."
            }
          ]
        ]
      },
      {
        "type": "heading",
        "text": "Compare Like With Like",
        "id": "compare-like-with-like"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "MOM"
              }
            ]
          },
          {
            "type": "text",
            "text": " column displays and sorts by six-month adjusted-close returns for both stocks and ETFs, using the same price-history calculation as the asset-class performance summaries. Missing history displays a dash, not a zero or a return from a different period. Hover shows the price-data date and any stale-data warning."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Stocks and ETFs share the same sign-only return colours: green above 0%, red below 0% and neutral at zero. ETF returns remain visible on hover; no stock sizing modifier applies to them. The separate ETF Ranking view keeps its existing 80/240-session momentum model, scores and allocation logic unchanged."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Suggested percentages can change with research, momentum and new evidence. They do not approve a new portfolio shape or place orders. Analysis weights the IN research universe, including unheld candidates. Positions' "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Ideal wt"
              }
            ]
          },
          {
            "type": "text",
            "text": " uses the same engine across actual holdings, independently of Analysis IN/OUT, and expresses the result as a share of the whole class after ETF allocation. When both stock sets match, the weights agree after this ETF adjustment."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "An optional "
          },
          {
            "type": "link",
            "href": "#/help/positions",
            "children": [
              {
                "type": "text",
                "text": "Weight management policy"
              }
            ]
          },
          {
            "type": "text",
            "text": "\ndefaults Off. Enabling it in Positions\nuses the backend held-stock ideal amount to limit new purchases and review material\nexcess, without freezing research or turning the Analysis watchlist into holdings."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Data issues > Incomplete sizing research"
              }
            ]
          },
          {
            "type": "text",
            "text": " flags stocks without a complete\nprimary-model result (Quality, Value and that model's price target). It includes\nIN research stocks and held stocks, even when OUT in Analysis. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Review research"
              }
            ]
          },
          {
            "type": "text",
            "text": "\nfilters the table to those securities; "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Show all securities"
              }
            ]
          },
          {
            "type": "text",
            "text": " clears the filter.\nAnalysis can still compare its researched candidates. Positions is stricter:\nif any held stock lacks a complete model result, the whole class's stock\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Ideal wt"
              }
            ]
          },
          {
            "type": "text",
            "text": " values show dashes until research is complete. Core ETF targets\nare independent. One complete Gemini, Perplexity, GPT or Claude result per held\nstock is sufficient; all four are not required. Council alone does not provide\nthe sizing base score. Missing current prices also withhold the class reference;\nuse the existing price refresh controls. See "
          },
          {
            "type": "link",
            "href": "#/help/positions",
            "children": [
              {
                "type": "text",
                "text": "Ideal weight"
              }
            ]
          },
          {
            "type": "text",
            "text": "."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Review Identity Problems",
        "id": "review-identity-problems"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "A provider-name mismatch or unavailable listing opens evidence for review. It does not prove delisting or identify a successor ticker. Confirm name, exchange and ticker changes using reliable evidence; check the associated TradingView connections after changing symbols."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The archive icon beside a security's name retires it from allocations, rankings and strategy views. Unlike In/Out, which controls sizing participation while keeping research visible, archiving hides the instrument by default. Held instruments require confirmation; broker holdings, account totals and statement history are not deleted or sold. Use Analysis view options > Show excluded instruments to inspect archived rows and the restore arrow to return one to strategy, rather than creating a duplicate research row."
          }
        ]
      }
    ]
  },
  {
    "id": "portfolio",
    "label": "Portfolio",
    "title": "Portfolio shape",
    "body": "Portfolio starts with the approved asset-class shape and compares current holdings against it. It separates portfolio construction decisions from signals on individual securities.",
    "blocks": [
      {
        "type": "heading",
        "text": "Read The Shape",
        "id": "read-the-shape"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The approved version and date identify the reference. The approved ribbon appears first; holdings appear underneath in the same class order and colours. Classes are ordered by approved weight, with stable class-code ordering for ties, so market movement does not rearrange the plan. An approved class with no holdings stays visible. Holdings outside the approved shape remain visible and are labelled as such."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The page opens on the current "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Approved"
              }
            ]
          },
          {
            "type": "text",
            "text": " shape. The coloured bar, first percentage, Cumulative and Per $1K always follow approved weights. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Compare"
              }
            ]
          },
          {
            "type": "text",
            "text": " adds the current holdings ribbon, markers and Held/Difference columns; turning it off removes that comparison, never the approved shape. The button is highlighted only while comparison is active. Difference means held minus approved, not investment return or an instruction to trade; selecting it enables comparison, and turning comparison off returns to Shape. Radial keeps the approved shape as the coloured polygon, adding holdings as a dashed outline only when Compare is selected."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The bottom-right "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Portfolio summary"
              }
            ]
          },
          {
            "type": "text",
            "text": " opens as a single ring of the current approved shape. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Compare with current allocation"
              }
            ]
          },
          {
            "type": "text",
            "text": " adds holdings as the inner ring; the outer ring remains approved. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Show current portfolio shape"
              }
            ]
          },
          {
            "type": "text",
            "text": " returns to the single approved ring. There is no actual-only view in this widget, and missing approval never substitutes current holdings. Its main percentages are saved approved weights, not dollar holdings or renormalised partial totals. The Positions comparison strip keeps approved amounts visible rather than hiding them until hover. Positions holdings, account totals and performance remain actual-first."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "If there is no approval, the application explicitly shows holdings without an approved shape. If current data is stale or unavailable, saved approved weights remain visible; unavailable holdings are not reported as an empty portfolio and current differences are withheld. Approval and holdings refresh failures are reported independently."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Inspect Without Changing Anything",
        "id": "inspect-without-changing-anything"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Browse the timeline to inspect previous analyses, target drafts and approvals. The Portfolio toolbar stays available; click "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Timeline"
              }
            ]
          },
          {
            "type": "text",
            "text": " again or use "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Back"
              }
            ]
          },
          {
            "type": "text",
            "text": " to return to the previous view without resetting its settings. Select a saved memo to read its evidence in the Terminal. Opening a record does not approve it or start a new AI job."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The date strip combines approvals, targets and saved Portfolio Analysis memos from Alpha Edge Intelligence, including runs never previously opened in the Terminal. Selecting a record leaves its immediate neighbour visible on the left, so you can browse backwards without repeatedly using the arrow button. Daily broker observations stay out of this strip but remain available through "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Compare with"
              }
            ]
          },
          {
            "type": "text",
            "text": ". The memo and its proposed class weights appear together. Analyst and chairman documents are separate choices when their contents differ."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Compare"
              }
            ]
          },
          {
            "type": "text",
            "text": " adds a second record: compare two memos, approvals, or an approval against a memo. Both ribbons use the same class order, and the table includes classes removed from either shape. Change means the selected record minus the comparison, in percentage points. It is an allocation change, not investment return. Identical approvals say "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "No allocation change"
              }
            ]
          },
          {
            "type": "text",
            "text": "."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "An approved snapshot is headed by its version, such as "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Approved v17"
              }
            ]
          },
          {
            "type": "text",
            "text": ", followed by its approval date. Comparison shows the version and date for each snapshot, without repeating generic approval or source labels."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Create target draft"
              }
            ]
          },
          {
            "type": "text",
            "text": " saves the selected memo as evidence and opens the existing target workflow. It does not approve the recommendation. An approval without a linked memo remains manual; the application never guesses its source from a nearby analysis date."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Timeline loads saved records when opened. It has no type-filter count row, example generator or manual refresh toolbar. A memo archive failure does not interrupt browsing saved approvals; an unavailable linked memo is reported in its reader. Weights that do not total 100% are shown unchanged with a warning."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Shape, Cumulative, Difference and radial views offer different comparisons of the same class weights. Both comparison buttons remain visible. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "History"
              }
            ]
          },
          {
            "type": "text",
            "text": " stays highlighted while viewing saved approvals; "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Back"
              }
            ]
          },
          {
            "type": "text",
            "text": " in the history header returns to the live view with its previous comparison setting. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Compare"
              }
            ]
          },
          {
            "type": "text",
            "text": " returns directly to approved-versus-current comparison. Historical overlays refer to the selected saved approval, not today's research recalculated backwards. Keep the asset-class legend and denominator in mind when comparing views."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Run Portfolio Analysis",
        "id": "run-portfolio-analysis"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Select "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Run portfolio analysis"
              }
            ]
          },
          {
            "type": "text",
            "text": ", then optionally add "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Investment plays"
              }
            ]
          },
          {
            "type": "text",
            "text": " with a title and thesis. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Start analysis"
              }
            ]
          },
          {
            "type": "text",
            "text": " submits the current portfolio and those ideas together. No saved memo is required. You can also start without any plays."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The independent ideal portfolio and current-portfolio assessment are completed before the models see your plays. Subsequent reviews assess each idea with a reasoned score out of 10 and an Include, Watch, Reject or Needs research verdict. An idea can introduce a new exposure; its funding must be explained. Results appear in the memo, not as automatic changes to holdings."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Plays save automatically to the Terminal database, including unfinished drafts. They survive refreshes and are available from other browsers using the same Terminal account/environment. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Saved"
              }
            ]
          },
          {
            "type": "text",
            "text": " confirms storage; a failed save keeps the draft visible with a retry action. Closing the form does not start an analysis."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Check "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Include in this analysis"
              }
            ]
          },
          {
            "type": "text",
            "text": " for each saved play you want assessed. Existing plays are not automatically selected in a fresh session; new plays are selected as you add them. Deselecting retains the play in the library. The trash icon deletes it from the library, without changing past memos. Starting an analysis saves pending edits before submitting the selected plays."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Change The Shape Deliberately",
        "id": "change-the-shape-deliberately"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "A new analysis is evidence for a possible target, not approval. Review the proposed class weights and compare them with the current approval and holdings. Use the target/rebalance workflow to formalise a change. Required reductions and later statement confirmation remain distinct from approving a new distribution."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Q3 can reduce the permitted class budget while still allowing purchases within the new limit. Q4 pauses increases in affected assets until it clears. Neither should be mistaken for a fresh user-approved shape."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Portfolio Cycles",
        "id": "portfolio-cycles"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Once approved, a shape cannot be replaced for "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "four calendar months"
              }
            ]
          },
          {
            "type": "text",
            "text": ". The first approval is unrestricted. Approval controls show the next available date; there is no early override. Research and target planning remain available, but a replacement baseline waits for that date. Q3/Q4 risk actions and ordinary security adds/trims are unaffected."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Return %"
              }
            ]
          },
          {
            "type": "text",
            "text": ", immediately after Approved, measures the assets held at the start of that shape's cycle. The compact summary shows the best-performing security. A completed cycle runs from one approval to the next; the current cycle runs from its approval to now. Select an approved version in Timeline to see its own cycle."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "These are adjusted-price returns, not your personal P/L. Class results use opening holding values as weights, exclude later purchases and retain securities sold during the cycle. They do not include personal trade timing, fees or currency gains. Price-provider adjustments may include dividends and splits. Use the information icon for the opening statement, coverage and measurement details."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "code",
            "text": "—"
          },
          {
            "type": "text",
            "text": " means evidence is unavailable, not a zero return. A class needs price evidence for every opening holding; the best-performer summary needs the whole opening basket. Cash has no assumed interest return. Historical approvals are kept as recorded, including older versions closer together than the new four-month minimum."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Colours And History",
        "id": "colours-and-history"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Click an asset-class colour square to choose from the shared palette. A single click previews the choice; Save or double-click confirms it. The same class colour is used across the application and does not represent Buy or Sell."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "In "
          },
          {
            "type": "link",
            "href": "#/help/history",
            "children": [
              {
                "type": "text",
                "text": "History"
              }
            ]
          },
          {
            "type": "text",
            "text": ", approval markers show the locked shape alongside the previous approval when available. An unavailable previous shape is not an all-zero portfolio."
          }
        ]
      }
    ]
  },
  {
    "id": "etfs",
    "label": "ETFs",
    "title": "Core ETFs and momentum",
    "body": "Core ETFs implement part of an approved asset class. Momentum adjusts their emphasis within that class; it does not replace the approved portfolio shape with a separate ETF portfolio.",
    "blocks": [
      {
        "type": "diagram",
        "id": "etf-allocation",
        "label": "Core ETF allocation calculation",
        "nodes": [
          "Class budget",
          "Core ratio",
          "Momentum",
          "ETF target",
          "Trend gate"
        ]
      },
      {
        "type": "heading",
        "text": "Choose Core In Context",
        "id": "choose-core-in-context"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Double-click the fund in Positions to open the Security sidebar, or use the ETF sidebar's fund controls. Core selection and removal are separate from ratio selection. A 1:4 ratio allocates one quarter of the class budget to the Core base; 1:2 means half and 1:1 means the whole class. Positions keeps the ratio as a compact read-only chip."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Core is a role, not an instrument type or a TradingView script. A fund must be correctly classified and assigned in Analysis. An unheld Core target can appear in the sidebar without becoming a broker holding."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Understand The Target",
        "id": "understand-the-target"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The class budget and Core ratio determine the base. The momentum model then increases or decreases that base within configured limits. The current default influence is 50%: a preference 20% above the model's equal-share reference produces a 10% increase in the Core base. Influence is a setting, not another 50% portfolio allocation."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The fixed legacy model has 15 members. When all 15 weights are available and sum to 100%, their equal-share reference is 6.67%. The calculation uses the available model rows, so missing rows or a different total can change that reference. The reference contributes no cash. A $4,000 approved class budget at 1:4 gives a $1,000 base; a 1.10 multiplier gives a $1,100 recommended target."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The ledger caps the recommended ratio at the whole class and sets its effective target to zero on Sell. This target is not a funded purchase permission: current Q3/Q4, trend, connection, capacity and cash checks still apply before an increase."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Unused ETF capacity can be used by stocks in the same class. ETFs still held continue to occupy capacity even if their target falls to zero. Capacity is not available cash, and a model adjustment is not automatically a worthwhile trade."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Optional Weight Management",
        "id": "optional-weight-management"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The opt-in Weight management setting beside Ideal wt in Positions\nlimits Core ETF purchases to the effective target and proposes a reduction\nback to that target at 125% coverage. The breach must persist across two fresh\ndaily observations, and the proposed sale must be at least the greater of A$100\nor 0.25% of portfolio value. Coverage visuals alone do not create trade instructions."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The setting defaults Off. Off leaves targets and coverage visible but\nremove individual weight ceilings, without removing class capacity, cash,\nQ3/Q4 or profile-specific signals. These rules depend on the Core role, not\nwhich TradingView management profile the fund uses. Removing Core status will\nnot itself request liquidation. See "
          },
          {
            "type": "link",
            "href": "#/help/positions",
            "children": [
              {
                "type": "text",
                "text": "Positions"
              }
            ]
          },
          {
            "type": "text",
            "text": "\nfor the full agreed policy and the handling of pending executions."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Read The Coverage Bar",
        "id": "read-the-coverage-bar"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The ETF sidebar starts with a compact "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "ETF allocations"
              }
            ]
          },
          {
            "type": "text",
            "text": " summary. Select the "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "ETF allocations"
              }
            ]
          },
          {
            "type": "text",
            "text": " title to open the ETF tab's ranking and allocations. The dollar pair shows held value / effective ETF target, with a full-width funding bar underneath. The smaller signed amount is held value minus effective ETF target: red positive is above target; blue negative is below target. This is an allocation difference, not profit or loss. Hover or focus the summary, or tap it on touch screens, for labelled details. The three icons beside the heading switch between Line Fill, Capital Map and Ring Fill. Your selected view is remembered."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Line Fill is a compact allocation list. Each fund shows its ticker and held / target amounts on the first row, then its asset class, available trend and allocation difference below. Its funding bar spans the row underneath. Differences below $250 remain muted for readability; this is not a trade threshold. Click a fund to open its existing Core and ratio controls."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "In Line Fill, the marker at 80% of the track represents a fully funded target. Empty space before it is underfunding; red beyond it is overcommitment. The final segment represents up to 25% above target and is bounded; the numbers remain exact even when the bar is full. A known zero target makes all held value excess. An unavailable target leaves the bar unfilled, without a marker or calculated difference; it is not a known target of zero."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Ring Fill uses the earlier bordered fund cards: a funding circle, ticker and fund name, held / target amounts and asset class. The number on the right shows the difference from that fund's effective ETF target. Click the number to switch between percentage and dollars; click elsewhere on the card for the same Core and ratio controls as Line Fill."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The percentage is "
          },
          {
            "type": "code",
            "text": "(held - target) / target x 100"
          },
          {
            "type": "text",
            "text": ". For example, $1,250 held against a $1,000 target shows "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "+25.0%"
              }
            ]
          },
          {
            "type": "text",
            "text": ", or "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "+$250"
              }
            ]
          },
          {
            "type": "text",
            "text": " after clicking. Red positive means above target, blue negative means below target, and zero is neutral. This is not momentum, investment return or percentage points of your whole portfolio. A missing target shows an unavailable difference. With a zero target and remaining holdings, the dollar difference is available but the percentage is not; click the number to see dollars."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The circle compares held value with the current effective target. At 50% funding it is half blue; at 100% it is fully blue. Above target, a red arc overlays the excess: 125% funding shows a quarter red, and 200% or more shows a full red ring. Exact held/target amounts remain visible. Empty holdings show an unfilled track; a missing target shows a dashed unfilled track. If the target is explicitly zero, any remaining holding is all excess and the ring is red. These displays do not change targets or submit trades."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The optional Capital Map offers another view of allocation footprint. Neither visual is an instruction to buy. Watchlist funds are candidates not currently held; selecting Core does not execute a purchase."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Management And Ranking",
        "id": "management-and-ranking"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "ETF mode uses the dedicated ETF script and its exit behaviour. TMS mode uses the CDF/TMS workflow while retaining the instrument's ETF classification. Changing modes requires an initial direction and compatible connections in Alerts; unresolved execution evidence must be reconciled first."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "TMS can suit holdings you intend to retain through weaker trends: partial trims and stops may defer gains on retained units, at the cost of potentially deeper drawdowns. ETF mode can suit tactical holdings where a full exit on Sell takes priority. Neither is a universal winner, and Core status does not choose the mode. Our eight-fund screen found mixed results; it did not measure after-tax returns. Partial sales still realise gains or losses, and distributions and CFDs have separate tax treatment."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The Ranking view shows model returns, volatility, score, rank, weights and source dates. Price refresh, recalculation and publication are different events. The latest calculated ranking may not be the published weight currently used for allocation. Adding an ETF to Analysis does not automatically expand the engine's configured universe."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "In the full ETF page, Allocation and Momentum switch between class implementation and ranking. Calculation details in Momentum contains the model identifier, run information and source dates. This disclosure changes presentation only; the published allocation weights and ranking calculations are unchanged."
          }
        ]
      }
    ]
  },
  {
    "id": "markets",
    "label": "Markets",
    "title": "Market gates",
    "body": "Markets follows commodity-linked evidence through Commodity, Equity, Company and Outperform. These are recorded trend states, not four automatic instructions to purchase.",
    "blocks": [
      {
        "type": "heading",
        "text": "Direct commodity sleeve",
        "id": "direct-commodity-sleeve"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Commodity is the direct commodity CDF for that market. It governs an approved direct-commodity vehicle and does not open, close or resize producer-equity exposure. If no accessible vehicle exists, positive commodity evidence alone cannot create one to buy."
          }
        ]
      },
      {
        "type": "diagram",
        "id": "market-direct",
        "label": "Direct commodity bullish path",
        "nodes": [
          "Commodity"
        ],
        "result": "Commodity BULL"
      },
      {
        "type": "heading",
        "text": "Equity, Company, then Outperform",
        "id": "equity-company-then-outperform"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Equity is the producer basket relative to its commodity. Company summarises the existing CDF state of eligible companies in that market. Outperform summarises each eligible company relative to the producer basket. Research, entry, sizing, cash and TMS remain separate controls."
          }
        ]
      },
      {
        "type": "diagram",
        "id": "market-equity",
        "label": "Producer equity bullish evidence path",
        "nodes": [
          "Equity",
          "Company",
          "Outperform"
        ],
        "result": "Path open"
      },
      {
        "type": "heading",
        "text": "Reading The Market Map",
        "id": "reading-the-market-map"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Each row has two column groups, because the direct commodity and producer\nequities are separate sleeves."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Direct commodity"
              }
            ]
          }
        ]
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Trend:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the direct commodity CDF, shown as Bull or Bear."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "60D:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the direct commodity source's 60-day return, with its own source date on hover."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Vehicle:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the approved broker vehicle, if one is recorded. A dash means the\nmarket is signal only, so the trend is context. "
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Review vehicle"
                }
              ]
            },
            {
              "type": "text",
              "text": " means the\ndirect sleeve has a target but no approved vehicle."
            }
          ]
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Producer equities"
              }
            ]
          }
        ]
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Equity regime:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the producer basket relative to its commodity (for example\n"
            },
            {
              "type": "code",
              "text": "GDX / GLD"
            },
            {
              "type": "text",
              "text": "). "
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Open"
                }
              ]
            },
            {
              "type": "text",
              "text": " is a Buy state: new producer-equity entries follow the\nnormal CDF/TMS rules. "
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Closed"
                }
              ]
            },
            {
              "type": "text",
              "text": " is a Sell state: new entries, adds, breakouts\nand re-entries are blocked."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Qualifying:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the companies that are both in a CDF uptrend and outperforming\nthe producer basket, counted per company, for example "
            },
            {
              "type": "code",
              "text": "2 of 4"
            },
            {
              "type": "text",
              "text": ". The marks show\nevery eligible company: solid for Qualifies, hollow for Lags basket (uptrend\nbut underperforming), a dash for Downtrend and a dashed outline for Incomplete\nevidence. They are dimmed while the regime is closed, because they cannot\nunlock new deployment."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Held / budget:"
                }
              ]
            },
            {
              "type": "text",
              "text": " invested producer-equity value against the approved sleeve\nbudget. Class cash held appears on hover."
            }
          ]
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The header counts how many equity regimes are open. No row combines these\nsignals into a verdict or target."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Signal States",
        "id": "signal-states"
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Bull / Open:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the recorded closed-bar CDF state is Buy."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Bear / Closed:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the recorded closed-bar CDF state is Sell."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Off or dash:"
                }
              ]
            },
            {
              "type": "text",
              "text": " no connected feed or usable current state is available. It is\nnot a neutral or bearish observation."
            }
          ]
        ]
      },
      {
        "type": "heading",
        "text": "Market Detail",
        "id": "market-detail"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Clicking a market row opens its detail view, using the same two sleeves."
          }
        ]
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Direct commodity:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the commodity trend with its 60-day return and the\ndate of the latest signal. A vehicle line appears only when a broker vehicle\nis approved or needs review; signal only is the default and is not restated."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Producer equities:"
                }
              ]
            },
            {
              "type": "text",
              "text": " the equity regime (Open or Closed, with what that\npermits) and the qualifying companies with their standing mix. Each signal\nshows the date of its latest event, because an old signal is not the same\nas a current one."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Sleeve:"
                }
              ]
            },
            {
              "type": "text",
              "text": " held producer equities with their share of the approved budget,\nthe approved budget and class cash held. Class cash stays within the class."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Company evidence:"
                }
              ]
            },
            {
              "type": "text",
              "text": " each company's Trend, its direction against the\nproducer basket and its standing. Select a company to show it in both the\nCompany trend and Outperform charts; the chart titles name the company.\nProducer ETFs in the class are listed below the companies under "
            },
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Funds"
                }
              ]
            },
            {
              "type": "text",
              "text": "\nwith their own trend. Selecting a fund charts it in the trend chart;\nOutperform applies to companies only, and funds never count towards\nQualifying."
            }
          ]
        ]
      },
      {
        "type": "heading",
        "text": "Configure And Investigate",
        "id": "configure-and-investigate"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "A plug icon appears beside the expand control only when a connection is missing; it opens "
          },
          {
            "type": "link",
            "href": "#/help/alerts",
            "children": [
              {
                "type": "text",
                "text": "Alerts"
              }
            ]
          },
          {
            "type": "text",
            "text": ", where you record the feed and its current direction. The expand control lists each company with its Trend, its direction against the producer basket and its resulting standing, aligned under the Producer equities columns. Clicking the market row opens its detailed view."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Edit the market at the left edge to update its name and source pair when an exchange symbol changes. Source changes also affect the corresponding Alerts setup; confirm the new source rather than assuming the old connection still applies. The 60-day percentage sits in the Direct commodity group. It is price-history evidence with its own source date, separate from the trend signal and from the producer-equity regime."
          }
        ]
      }
    ]
  },
  {
    "id": "alerts",
    "label": "Alerts",
    "title": "Alert connections",
    "body": "Alerts is the setup ledger for TradingView signals and announcement emails from HotCopper and Seeking Alpha. It records which alerts you have configured, not which positions should be bought or sold.",
    "blocks": [
      {
        "type": "heading",
        "text": "Watchlist Entries",
        "id": "watchlist-entries"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Use the horizontal "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Positions / Watchlist"
              }
            ]
          },
          {
            "type": "text",
            "text": " selector in the left Alert Stack.\nBoth views use the same asset-class groups, alert chips and expand/collapse control.\nPositions shows held-position alerts; Watchlist shows received alerts for unheld\nwatchlist securities, not the entire research universe. Portfolio risk stays above\nboth views. Breakout and Outperform describe\ndifferent evidence; Outperform names the configured benchmark on hover, not an\nassumed broad-market index. Current holdings remain under "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Positions"
              }
            ]
          },
          {
            "type": "text",
            "text": "."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Select a row to open "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Entry review"
              }
            ]
          },
          {
            "type": "text",
            "text": " in the right sidebar. It shows a suggested\nfirst-entry amount or the reason entry is paused, plus class exposure, cash and\nthe candidate's prospective Ideal wt. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Peer Ideal wt"
              }
            ]
          },
          {
            "type": "text",
            "text": " compares the model with\nand without that one candidate. It does not recommend selling the differences."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Ready to review"
              }
            ]
          },
          {
            "type": "text",
            "text": " means the existing research, signal, risk, class-capacity and\nstatement-backed funding checks pass. It is not an order or a new quality-score\nendorsement. Check the current execution price against the entry rule yourself.\nIncomplete research, stale statement/price evidence, missing signals, full\nclasses and pending trades stay visible with a reason."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Each candidate is an alternative use of the same cash, not a reserved allocation.\nOpening this view never changes held Ideal weights, creates an order, trims a\nposition or moves money. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Review action"
              }
            ]
          },
          {
            "type": "text",
            "text": ", when a current action exists, opens\nthe existing execution review; recording still rechecks permission and funding.\nAfter a statement confirms a holding, it leaves the unheld watchlist view."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Watchlist connection setup remains in "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Alerts > Watchlist"
              }
            ]
          },
          {
            "type": "text",
            "text": ". Research remains in\nAnalysis; entry assessment is opened from a watchlist alert in the stack."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Set Up A Connection",
        "id": "set-up-a-connection"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "First configure the correct script, ticker or ratio and webhook in TradingView. Then confirm that setup in the matching row in Alpha Edge. The checkbox records your confirmation; it does not create a TradingView alert remotely."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "For CDF and dedicated ETF signals, supply the current Buy or Sell direction when initialising. This provides a usable baseline before the next transition arrives. TMS setup is connection-only. Repeated TradingView restart connection messages must not overwrite a deliberate baseline."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Commodity rows contain the physical commodity and producer-equity connections. Company outperformance appears with stock connections. A missing ticker needs correction before the matching feed can be trusted. Ensure an ETF's chosen management mode matches its configured scripts."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The connection indicators in Analysis and Positions include a commodity stock's\nrequired Outperform connection. Their hover text names missing setup. ETFs use\ntheir selected ETF/TMS profile, not their Core assignment. See\n"
          },
          {
            "type": "link",
            "href": "#/help/analysis",
            "children": [
              {
                "type": "text",
                "text": "Analysis guide"
              }
            ]
          },
          {
            "type": "text",
            "text": " for the monitoring colour key."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Set Up Announcement Emails",
        "id": "set-up-announcement-emails"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Open "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Alerts > Announcements"
              }
            ]
          },
          {
            "type": "text",
            "text": ". The tab shows the number needing setup. A visible\nreminder above the other connection tables also opens this list directly."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Adding a security to Alpha Edge does not add it to HotCopper or Seeking Alpha.\nIG statement imports do not configure these announcement subscriptions.\nASX securities default to "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "HotCopper"
              }
            ]
          },
          {
            "type": "text",
            "text": "; all other exchanges default to\n"
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Seeking Alpha"
              }
            ]
          },
          {
            "type": "text",
            "text": ". Saved provider confirmations are retained unless the listing\nchanges. Open the provider's watchlist/portfolio and enable that security's\nannouncement/news emails to the mailbox used by your Announcement Router.\nReturn and use the checkmark to "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Mark configured"
              }
            ]
          },
          {
            "type": "text",
            "text": ". Select several rows to\nconfirm subscriptions you have already enabled, up to 100 at a time."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Configured"
              }
            ]
          },
          {
            "type": "text",
            "text": " records your confirmation, not proof an announcement was delivered.\nOpening the provider link alone never clears the reminder. New securities start\nunconfirmed; no subscription is inferred from a broker import, research result\nor TradingView connection. ETFs and OUT research are included; hidden instruments\nare not. Missing tickers or exchanges must be fixed before confirming."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Use "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "All"
              }
            ]
          },
          {
            "type": "text",
            "text": " to review saved setup or reset it with the undo icon. A ticker or\nexchange change requests a recheck. Confirmation follows the security across\nimports and restarts. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Announcements"
              }
            ]
          },
          {
            "type": "text",
            "text": " remains accessible after all reminders\nare cleared. The public demo can show the list but cannot save confirmations."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "This reminder neither blocks purchases nor changes Ideal wt, and does not create\nAlert Stack trading chips. The green TradingView connection indicator does not\nverify announcement email subscriptions."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Provider references: "
          },
          {
            "type": "link",
            "href": "https://hotcopper.com.au/watchlist/",
            "children": [
              {
                "type": "text",
                "text": "HotCopper watchlist"
              }
            ]
          },
          {
            "type": "text",
            "text": "\nand "
          },
          {
            "type": "link",
            "href": "https://help.seekingalpha.com/basic/how-do-i-manage-my-email-alerts",
            "children": [
              {
                "type": "text",
                "text": "Seeking Alpha email alerts"
              }
            ]
          },
          {
            "type": "text",
            "text": "."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Connection Is Not Freshness",
        "id": "connection-is-not-freshness"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "A confirmed checkbox means the setup was recorded. It is not proof that TradingView is still running, that a new signal has arrived, or that prices are fresh. Check the latest signal evidence and source dates separately."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Where Actions Live",
        "id": "where-actions-live"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Use the left Alert Stack for current decisions. Ordinary statement waits do not require another click and remain in "
          },
          {
            "type": "link",
            "href": "#/help/history",
            "children": [
              {
                "type": "text",
                "text": "History"
              }
            ]
          },
          {
            "type": "text",
            "text": ". Missing or failed webhook processing belongs to integration diagnosis, not a new Buy/Sell instruction."
          }
        ]
      }
    ]
  },
  {
    "id": "system",
    "label": "System",
    "title": "Decision hierarchy",
    "body": "System gives a top-down view of risk state, current allocation, market signals and the positions currently held. It is a map of the existing rules, not another source of trade instructions.",
    "blocks": [
      {
        "type": "heading",
        "text": "Asset-Class Index",
        "id": "asset-class-index"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Open "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "System > Asset classes"
              }
            ]
          },
          {
            "type": "text",
            "text": " for the full classification index, including\nclasses you do not hold. Search by name, class code, parent or rationale; use the\nQ1, Q1-Defensive and Q1-Exempt filters to narrow it down. "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Decision flow"
              }
            ]
          },
          {
            "type": "text",
            "text": " returns\nto the numbered system overview."
          }
        ]
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Q1"
                }
              ]
            },
            {
              "type": "text",
              "text": " classes receive the full Q3 equity-reduction sensitivity."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Q1-Defensive"
                }
              ]
            },
            {
              "type": "text",
              "text": " classes remain within Q1 but have reduced Q3 sensitivity."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Q1-Exempt"
                }
              ]
            },
            {
              "type": "text",
              "text": " classes sit outside Q1 equity reductions. They can still be affected\nby liquidity rules and Q4; this is not a claim that they are risk-free."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Cash / unclassified"
                }
              ]
            },
            {
              "type": "text",
              "text": " keeps reserve and incomplete classifications separate."
            }
          ]
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The index uses the same configured "
          },
          {
            "type": "code",
            "text": "overlay_eligible"
          },
          {
            "type": "text",
            "text": " and "
          },
          {
            "type": "code",
            "text": "q3_beneficiary"
          },
          {
            "type": "text",
            "text": " flags\nas Positions and Analysis. These are the application's strategy classifications,\nnot a generic industry definition of defensiveness. For example, the default\nTelecommunications classification is Q1, while Infrastructure is Q1-Exempt.\nGroup labels and system buckets are identified separately from allocation classes.\nThe rationale comes from the backend configuration, including custom classes.\nMissing configuration is shown as unclassified, never silently labelled exempt."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The index is read-only: browsing it does not change budgets or strategy rules."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Read From Top To Bottom",
        "id": "read-from-top-to-bottom"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The numbered review sequence is "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "01 Risk → 02 Allocation → 03 Markets → 04 Positions"
              }
            ]
          },
          {
            "type": "text",
            "text": ".\nThe navigation and section headings share these stage numbers. They indicate the\norder of review, not completed steps or additional trade approvals."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Start with Q3/Q4 and the current permitted budget. Then inspect the current asset-class mix, commodity and producer evidence, and finally the held positions and their signals. A company in Analysis but not held does not become a position just because it has research."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The chevron beside each section title collapses or expands its contents; all four sections start expanded. Collapsing a section keeps its title, summary and navigation available without clearing its search or position-group choices. The top section links expand their destination before jumping to it within the same scrolling page."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The outward arrows at the right of section headings open Positions, Portfolio or Markets. Market rows open their existing market detail; security rows return to Positions. Position groups can be collapsed, or searched by name, ticker or asset class. Search temporarily reveals matching rows and their held subtotals without changing the current expansion choices or holdings."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Allocation And Signals",
        "id": "allocation-and-signals"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Current allocation"
              }
            ]
          },
          {
            "type": "text",
            "text": " uses the current portfolio-mix read model, including class cash as defined by Portfolio. It is not the approved target. The bar and class percentages use the same weights, with the shared class colours; open Portfolio to compare with an approved shape."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Commodity and Equity are separate columns. A market's "
          },
          {
            "type": "code",
            "text": "CONFIRMED"
          },
          {
            "type": "text",
            "text": " / "
          },
          {
            "type": "code",
            "text": "BLOCKED"
          },
          {
            "type": "text",
            "text": " evidence is displayed as "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Bull"
              }
            ]
          },
          {
            "type": "text",
            "text": " / "
          },
          {
            "type": "strong",
            "children": [
              {
                "type": "text",
                "text": "Bear"
              }
            ]
          },
          {
            "type": "text",
            "text": ", matching Markets; it is not an instruction to place a trade. Legacy Waiting and Partial evidence remains distinct from No signal. No combined market confirmation count is used as a budget or permission."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Held securities show their existing Buy / Sell trend and their own Outperform evidence where assigned. The security table excludes non-allocating instruments and does not turn watchlist research into a holding. Values remain available on narrow screens beneath the name when the separate Held column no longer fits."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The same class or security should agree with its detailed page. Use Positions, Portfolio or Markets to act on the underlying workflow rather than treating a System summary as separate approval."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Missing State",
        "id": "missing-state"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "An empty state means the backend lacks usable evidence or the request failed. Supplying an API token fixes authorisation only. It cannot populate a database, establish a TradingView baseline or create a broker statement."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "System rereads the existing risk, mix, market and position endpoints every 30 seconds, or on refresh. This does not fetch new market prices or generate signals. Failed sections are named in a warning; previously received values are retained while other sections keep working. Missing risk data is never labelled Normal or Clear."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "The asset-class index rereads the registry and classification configuration every\n60 seconds while open, with a refresh button. A failed refresh is flagged and\nretains previously loaded classifications; it does not substitute static defaults\nfor a private account's settings."
          }
        ]
      }
    ]
  },
  {
    "id": "news",
    "label": "News",
    "title": "Narrative evidence",
    "body": "News organises market narratives, supporting updates and thesis evidence in the context of the portfolio. It does not approve a portfolio shape or replace a recorded trading signal.",
    "blocks": [
      {
        "type": "heading",
        "text": "Read The Evidence And Date",
        "id": "read-the-evidence-and-date"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Review a thesis, its supporting updates, conviction history and invalidation evidence. Distinguish a saved observation from a newly calculated result. A narrative can remain visible while its source is stale or a refresh has failed."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Foundation and daily work can run as background jobs. Check the job status before starting another run. Daily scheduling depends on backend settings and provider availability; the word daily does not guarantee a successful new result every day."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Run Daily remains the primary command. The three-dot News tools menu contains Run Foundation and Deduplicate. Run details shows the saved model and foundation provenance. Open a headline for its supporting summary and sources; dates beside the brief describe the saved result, not the current job."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Connect It To A Decision",
        "id": "connect-it-to-a-decision"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Use new evidence to revisit research or review a portfolio target. News does not silently change an approved allocation or place an order. Portfolio memos and announcement evidence have their own source and job history."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Failed Or Missing Results",
        "id": "failed-or-missing-results"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Check the last successful source date and provider/job error. A failed paid job is not a reason to repeatedly resubmit without checking whether the first request was accepted. Missing evidence should remain visible as missing, not be interpreted as reassurance."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "A failed run keeps its status visible. Expand Error details for the provider's diagnostic message; a failed run does not erase the last successful brief."
          }
        ]
      }
    ]
  },
  {
    "id": "history",
    "label": "History",
    "title": "Performance and decisions",
    "body": "History separates statement-derived performance from saved shapes, signal events and user-recorded responses. It is where you can investigate what changed and what evidence confirmed it.",
    "blocks": [
      {
        "type": "heading",
        "text": "Choose A View",
        "id": "choose-a-view"
      },
      {
        "type": "list",
        "ordered": false,
        "items": [
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Activity:"
                }
              ]
            },
            {
              "type": "text",
              "text": " switch between Decisions (your recorded responses and their verification) and Signals (incoming instructions and connection events). One ledger fills the available space. Search by ticker or asset class; class events display the class name rather than its internal identifier."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Portfolio:"
                }
              ]
            },
            {
              "type": "text",
              "text": " compare total and invested account value, then inspect asset-class weights and approval markers over the same period. The charts sit alongside each other when space permits and stack on smaller workspaces. The corner expand control changes chart height without hiding either chart."
            }
          ],
          [
            {
              "type": "strong",
              "children": [
                {
                  "type": "text",
                  "text": "Stocks:"
                }
              ]
            },
            {
              "type": "text",
              "text": " select a security by searching its company name or ticker. The company name leads the page, with the ticker below it. Price is shown by default; Show value adds holding value on a separate left axis, with price on the right."
            }
          ]
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Signals and Decisions render at most 100 records per page. Use the arrows beside the record count for older pages. Search covers all loaded records, not just the visible page, and returns to page one when changed. Paging does not delete or alter saved history."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Portfolio and Stocks share the 1M, 3M, 6M and All date ranges. Your chosen History view, range and chart-height setting are remembered on this browser. Chart colours follow the selected theme; asset classes keep their configured identity colours."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Inspect A Shape Approval",
        "id": "inspect-a-shape-approval"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "In the portfolio history chart, inspect an approval marker to see the class weights locked at that time. The approved and previous shape bars appear one above the other, with aligned class colours and percentage columns. If previous evidence is missing, the comparison cannot reconstruct it from today's holdings."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Nearby approvals share a counted marker when their labels would overlap. Open it and select a dated approval to inspect that exact version and its predecessor. Grouping changes with chart width and date range; it does not combine or delete saved shapes. Markers also open with keyboard focus; Arrow Down moves into the preview and Escape closes it."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Historical shape demonstrations are mock data and must remain identified as such. A demonstration is not a genuine approval or broker snapshot."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Find A Recorded Action",
        "id": "find-a-recorded-action"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Open Activity, then Decisions, or follow Decision history from the Alert Stack. A security link selects Decisions and filters the relevant evidence, including when History is already open. View record shows the source instruction, saved response and available execution/statement details. The ledger scrolls within the workspace; on narrow screens it also scrolls horizontally so record details remain accessible."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Awaiting statement means an execution was recorded but not yet verified. Variance means evidence did not match the expected change. Not applicable is a system closure and does not prove an executed sale. Do not record a second trade to clear a pending display."
          }
        ]
      },
      {
        "type": "heading",
        "text": "Understand Performance",
        "id": "understand-performance"
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Broker statements establish holdings and account history. External price charts are market-price context, not proof of personal investment returns. Deposits, withdrawals, security identity changes and missing statements can affect interpretation; check the evidence rather than assuming a smooth chart means complete data."
          }
        ]
      },
      {
        "type": "paragraph",
        "children": [
          {
            "type": "text",
            "text": "Value change is the difference between the first and last account values in the selected period, not a cash-flow-adjusted investment return. Holding value also changes when units change. The snapshot/event count below the portfolio chart opens the event legend; it does not imply complete data coverage."
          }
        ]
      }
    ]
  }
];
