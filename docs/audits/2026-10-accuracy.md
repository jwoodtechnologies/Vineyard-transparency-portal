# Accuracy audit, October 2026

Audited October 11, 2026. Every portal value below was read from the live API (vineyardportal.org) and compared with the text of its source document, page by page, as the portal extracted it (`/api/documents/<id>/text`), or with the CivicClerk API for meetings. The live data and document texts were captured by the Diagnostics workflow, runs 38138542665 and 38138718953 (branch `diagnostics`, `diag/<run id>/`).

## Summary

| Area | Sample | Items with a mismatch | Cause | Fix |
|---|---|---|---|---|
| City Council and RDA motions, 2026 | 40 of 102 (seeded random, Python `random.seed(20261011)`, `random.sample` over the motions sorted by id) | 8 | Parser: "Second:" and "Seconded:" with a colon not read; a mover with no space before "motioned"; page taken from the first place the wording appears (often the item heading on the page before), and no page at all when the wording was not read; "motioned," with a comma; a motion brought back by another member | worker/lib/votes.ts (`parseMinutes`, new `motionPages`), worker/api/votes.ts (parser 18 re-reads every set of minutes) |
| Planning Commission motions, 2026 | all 6 | 2 | Parser: misspelled titles "COMISSIONER" and "COMMISSIONERR" not read as a title, so no mover | worker/lib/votes.ts (`TITLE`) |
| FY27 budget lines and header cards | 26 (all 6 header cards) | 2 | Hand-typed data: Interest and Fines amounts swapped | worker/lib/budgetData.ts |
| Capital projects on /budget?view=projects | all 50 | 1 (department label, amount matches) | Hand-typed data: hydrant aprons department | worker/lib/budgetData.ts |
| Calendar meetings | 20 | 3 (place) | Mapping: CivicClerk `address2` dropped | worker/lib/civicclerk.ts, ingest/adapters/civicclerk.py (`eventAddress`) |
| People | 15 staff | 0 | | |

Found outside the samples and fixed: the staff directory printed the department "Recorder'S Office" (Python `str.title()`), and said 51 staff are on the City Staff page when 50 are (the city attorney is added by the ingest and is not on that page). Fixed in ingest/people.py.

Not changed: a few records show attendance that the minutes do not support (noted in the motion tables); attendance was outside this check. The amounts in the motion and budget tables were not changed except where the source text is quoted.

## 1. City Council and RDA motions (40)

Ours: page; mover; seconder; result and tally; each member's vote. Source: the minutes text on that page.

| # | Meeting | Source doc and page | Motion id | Ours | Source | Verdict |
|---|---|---|---|---|---|---|
| 1 | 2026-04-14 City Council | doc_750d956cc3d5a4a2 p6 | doc_750d956cc3d5a4a2:4 | p6; mover Wood; second none; carried 5-0; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | second Lauret ("Seconded: David Lauret") | Mismatch: seconder |
| 2 | 2026-09-15 Redevelopment Agency | doc_65bbcb853249cc0d p1 | doc_65bbcb853249cc0d:1 | p1; mover McCumber; second Wood; carried 5-0; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 3 | 2026-08-25 City Council | doc_7a0b2b44683f4559 p4 | doc_7a0b2b44683f4559:8 | p4; mover Lauret; second McCumber; carried ; none listed | same as ours | Match. Source says "passed unanimously" with no roll call; ours lists no member votes. |
| 4 | 2026-01-20 City Council | doc_656f5f5d85522440 p3 | doc_656f5f5d85522440:2 | p3; mover Nair; second Lauret; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 5 | 2026-09-15 City Council | doc_5f867130115b8be0 p4 | doc_5f867130115b8be0:2 | p3; mover Wood; second Lauret; carried 4-0; Lauret yes, Nair yes, Wood yes, McCumber yes, Holdaway abstain | motion printed on page 4 (page 3 ends with the 7.1 heading) | Mismatch: page |
| 6 | 2026-01-14 City Council | doc_20d8395f1ab4889f p2 | doc_20d8395f1ab4889f:1 | p2; mover Holdaway; second McCumber; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 7 | 2026-05-05 City Council | doc_16e2790fc996b4bf p1 | doc_16e2790fc996b4bf:1 | p1; mover Wood; second Nair; carried 4-0; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber absent | same as ours | Match |
| 8 | 2026-09-15 Redevelopment Agency | doc_65bbcb853249cc0d p2 | doc_65bbcb853249cc0d:2 | p2; mover Lauret; second McCumber; carried 5-0; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 9 | 2026-04-14 City Council | doc_750d956cc3d5a4a2 p3 | doc_750d956cc3d5a4a2:3 | p none; mover Nair; second none; carried 5-0; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | p3; motion "that Council Member Parker McCumber should be Mayor Pro Tem"; second Wood ("Second: Council Member Wood") | Mismatch: page, seconder, motion text |
| 10 | 2026-04-28 City Council | doc_12f9c647f8bd2fcb p4 | doc_12f9c647f8bd2fcb:5 | p4; mover Lauret; second McCumber; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 11 | 2026-06-23 Redevelopment Agency | doc_be4c84e576f5fcd4 p2 | doc_be4c84e576f5fcd4:2 | p1; mover Lauret; second Holdaway; carried 4-0; Lauret yes, Nair yes, Holdaway yes, Wood yes | motion printed on page 2 (page 1 ends with the 4.1 heading) | Mismatch: page |
| 12 | 2026-07-14 Redevelopment Agency | doc_125e390e8b99472b p2 | doc_125e390e8b99472b:2 | p2; mover Holdaway; second none; failed ; none listed | same as ours | Match. Source: "THERE WAS NO SECOND. THE MOTION FAILED." |
| 13 | 2026-06-09 Redevelopment Agency | doc_aa7cce8288e53fef p3 | doc_aa7cce8288e53fef:4 | p3; mover none; second Wood; carried 4-1; Lauret yes, Holdaway yes, Wood yes, McCumber yes, Nair no | mover Lauret ("Board Member Lauret.motioned toapprove", scan lost the space) | Mismatch: mover |
| 14 | 2026-06-23 City Council | doc_f7aa0533b44d693c p3 | doc_f7aa0533b44d693c:3 | p3; mover Holdaway; second Wood; carried 3-1; Lauret yes, Holdaway yes, Wood yes, Nair no | same as ours | Match. (Attendance on this record lists Wood absent, but he seconded and voted yes; attendance is outside this check.) |
| 15 | 2026-05-26 City Council | doc_43974cc0eb8e88f5 p4 | doc_43974cc0eb8e88f5:3 | p4; mover Nair; second Lauret; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 16 | 2026-06-09 Redevelopment Agency | doc_aa7cce8288e53fef p3 | doc_aa7cce8288e53fef:3 | p3; mover Lauret; second Wood; carried 4-1; Lauret yes, Holdaway yes, Wood yes, McCumber yes, Nair no | same as ours | Match |
| 17 | 2026-03-24 City Council | doc_965360a52383e70e p4 | doc_965360a52383e70e:5 | p none; mover Lauret; second McCumber; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | motion printed on page 4 | Mismatch: page |
| 18 | 2026-03-31 City Council | doc_84fbf9bd5e34fc28 p4 | doc_84fbf9bd5e34fc28:3 | p4; mover McCumber; second Lauret; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 19 | 2026-03-10 City Council | doc_2cad57c277953f4b p4 | doc_2cad57c277953f4b:7 | p4; mover Lauret; second Wood; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 20 | 2026-04-14 City Council | doc_750d956cc3d5a4a2 p3 | doc_750d956cc3d5a4a2:2 | p3; mover Nair; second none; carried 5-0; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | second Wood ("Second: Council Member Wood") | Mismatch: seconder |
| 21 | 2026-04-28 City Council | doc_12f9c647f8bd2fcb p3 | doc_12f9c647f8bd2fcb:4 | p3; mover Holdaway; second McCumber; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 22 | 2026-07-14 Redevelopment Agency | doc_125e390e8b99472b p2 | doc_125e390e8b99472b:1 | p2; mover Lauret; second McCumber; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 23 | 2026-08-04 City Council | doc_591f89080f688b25 p1 | doc_591f89080f688b25:1 | p1; mover McCumber; second Wood; carried 3-1; Lauret yes, Wood yes, McCumber yes, Nair no, Holdaway abstain | same as ours | Match |
| 24 | 2026-06-09 City Council | doc_5f05a843c98e70cb p6 | doc_5f05a843c98e70cb:3 | p6; mover Holdaway; second Wood; carried 5-0; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 25 | 2026-02-03 City Council | doc_2d9f9d1f66da2457 p2 | doc_2d9f9d1f66da2457:2 | p2; mover Nair; second Lauret; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes, Stratton yes | same as ours | Match |
| 26 | 2026-08-25 Redevelopment Agency | doc_3adf0eb6981cb20a p4 | doc_3adf0eb6981cb20a:1 | p4; mover Lauret; second Holdaway; carried ; Lauret yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match. (Attendance on this record lists two Planning Commission members as absent; outside this check.) |
| 27 | 2026-05-12 City Council | doc_70e8859cadb9c226 p2 | doc_70e8859cadb9c226:1 | p2; mover Holdaway; second Wood; carried 5-0; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 28 | 2026-02-24 City Council | doc_72fafbc263266ada p4 | doc_72fafbc263266ada:8 | p4; mover Lauret; second McCumber; carried 4-0; Lauret yes, Nair yes, Wood yes, McCumber yes, Holdaway absent | same as ours | Match |
| 29 | 2026-09-15 City Council | doc_5f867130115b8be0 p4 | doc_5f867130115b8be0:4 | p4; mover McCumber; second Holdaway; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match. Source prints the tally as "Motion Passed 50"; ours shows no tally. |
| 30 | 2026-07-14 Redevelopment Agency | doc_125e390e8b99472b p2 | doc_125e390e8b99472b:3 | p2; mover Lauret; second McCumber; carried ; Lauret yes, Nair yes, Wood yes, McCumber yes, Stratton yes, Holdaway no | same as ours | Match |
| 31 | 2026-03-10 City Council | doc_2cad57c277953f4b p4 | doc_2cad57c277953f4b:8 | p4; mover Holdaway; second McCumber; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 32 | 2026-06-09 City Council | doc_5f05a843c98e70cb p6 | doc_5f05a843c98e70cb:5 | p6; mover Lauret; second Holdaway; carried 5-0; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 33 | 2026-02-24 City Council | doc_72fafbc263266ada p3 | doc_72fafbc263266ada:3 | p3; mover McCumber; second Lauret; carried 4-0; Lauret yes, Nair yes, Wood yes, McCumber yes, Holdaway absent | same as ours | Match |
| 34 | 2026-01-27 City Council | doc_cf31e9aab11422d8 p3 | doc_cf31e9aab11422d8:2 | p3; mover McCumber; second Wood; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 35 | 2026-05-26 City Council | doc_43974cc0eb8e88f5 p3 | doc_43974cc0eb8e88f5:1 | p3; mover Nair; second Lauret; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 36 | 2026-09-15 City Council | doc_5f867130115b8be0 p5 | doc_5f867130115b8be0:5 | p5; mover Lauret; second Wood; carried 5-0; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 37 | 2026-05-26 City Council | doc_43974cc0eb8e88f5 p4 | doc_43974cc0eb8e88f5:4 | p4; mover Lauret; second Holdaway; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | same as ours | Match |
| 38 | 2026-01-27 City Council | doc_cf31e9aab11422d8 p3 | doc_cf31e9aab11422d8:5 | p none; mover none; second Holdaway; carried ; Lauret yes, Nair yes, Holdaway yes, Wood yes, McCumber yes | p3; "Mayor Pro Tempore Lauret brought back the original motion presented by Councilmember McCumber", second Holdaway | Mismatch: page, mover, motion text |
| 39 | 2026-03-10 City Council | doc_2cad57c277953f4b p3 | doc_2cad57c277953f4b:4 | p3; mover Holdaway; second Lauret; carried 4-1; Lauret yes, Holdaway yes, Wood yes, McCumber yes, Nair no | same as ours | Match |
| 40 | 2026-03-31 City Council | doc_84fbf9bd5e34fc28 p5 | doc_84fbf9bd5e34fc28:4 | p5; mover Lauret; second Wood; unknown ; none listed | same as ours | Match |

## 2. Planning Commission motions, 2026 (all 6)

| # | Meeting | Source doc and page | Motion id | Ours | Source | Verdict |
|---|---|---|---|---|---|---|
| 1 | 2026-05-06 Planning Commission | doc_92676662d170d22b p2 | doc_92676662d170d22b:1 | p2; mover Pearce; second Evans; carried 6-0; Fagg yes, Evans yes, Pearce yes, Ostler yes, Huntington yes, Steele yes | same as ours | Match. Source spells the mover "Commissioner Pierce"; ours David Pearce. |
| 2 | 2026-05-06 Planning Commission | doc_92676662d170d22b p4 | doc_92676662d170d22b:2 | p4; mover Steele; second Pearce; carried 6-0; Fagg yes, Evans yes, Pearce yes, Ostler yes, Huntington yes, Steele yes | same as ours | Match |
| 3 | 2026-03-04 Planning Commission | doc_87f4b9c0a818e65b p1 | doc_87f4b9c0a818e65b:1 | p1; mover none; second Ostler; carried ; Pearce yes, Ostler yes, Christensen yes, Huntington yes | mover Christensen ("COMISSIONER JORDAN CHRISTENSEN MOTIONED") | Mismatch: mover |
| 4 | 2026-03-04 Planning Commission | doc_87f4b9c0a818e65b p2 | doc_87f4b9c0a818e65b:3 | p2; mover Christensen; second Huntington; carried ; Pearce yes, Ostler yes, Christensen yes, Huntington yes | same as ours | Match on the checked fields. (Item label shows 4.1 minutes approval; the motion is about the 7 PM meeting time.) |
| 5 | 2026-03-04 Planning Commission | doc_87f4b9c0a818e65b p2 | doc_87f4b9c0a818e65b:4 | p2; mover none; second Huntington; carried ; Pearce yes, Ostler yes, Christensen yes, Huntington yes | mover Christensen ("COMMISSIONERR CHRISTENSEN MOTIONED") | Mismatch: mover |
| 6 | 2026-03-04 Planning Commission | doc_87f4b9c0a818e65b p5 | doc_87f4b9c0a818e65b:7 | p5; mover Christensen; second Huntington; carried ; none listed | same as ours | Match. Source roll call is garbled ("OSTLER, HUNTINGTON, HUNTINGTON, AND PEARCE"); ours lists no member votes. |

## 3. FY27 budget (26 values, every header card)

Books: FY 27 Final Budget doc_2c248c52cbadfa22, slides doc_4d69a97b95e87bea, First Budget Amendment doc_3931ec08b88d5fbf, amendment summary doc_9570af43463830a8, tentative budget doc_4f9d4e3b68713059.

| # | Value | Source doc and page | Ours | Source | Verdict |
|---|---|---|---|---|---|
| 1 | Header card: Revenue (General Fund) | doc_2c248c52cbadfa22 p2, p3 | 17,774,808 | 17,774,808 (Total Revenue & Transfers In) | Match |
| 2 | Header card: Spending (as amended) | doc_9570af43463830a8 p2; doc_3931ec08b88d5fbf p2 | 17,258,772 | 17,258,772 | Match |
| 3 | Header card: Surplus (as amended) | doc_9570af43463830a8 p2 | 516,036 | 516,036 | Match |
| 4 | Header card: Cut by the amendment | doc_9570af43463830a8 p2 | 245,382 | (245,382) variance column | Match (adopted minus amended is 245,381; the page prints 245,382) |
| 5 | Header card: Cut since tentative (tentative total) | doc_4f9d4e3b68713059 p2 | 17,712,003 minus 17,258,772 = 453,231 | 17,712,003 | Match |
| 6 | Header card: Cut from fiscal 2026 | doc_9570af43463830a8 p2 (AMEND #3 FY 25-26 and AMENDMENT FY 26-27 columns) | 1,018,261 across 11 departments | same 17 department pairs | Match |
| 7 | General Fund revenue before transfers | doc_2c248c52cbadfa22 p2 | 15,834,792 | 15,834,792 | Match |
| 8 | General Fund transfers in | doc_2c248c52cbadfa22 p2 | 1,940,016 | 1,940,016 | Match |
| 9 | General Fund adopted spending total | doc_2c248c52cbadfa22 p2, p4 | 17,504,153 | 17,504,153 | Match |
| 10 | General Fund adopted surplus | doc_2c248c52cbadfa22 p4 | 270,654 | 270,654 | Match |
| 11 | Police adopted / FY26 | doc_2c248c52cbadfa22 p2 | 4,705,075 / 4,103,125 | 4,705,075 / 4,103,125 | Match |
| 12 | Fire adopted / FY26 | doc_2c248c52cbadfa22 p2 | 2,873,462 / 2,585,600 | 2,873,462 / 2,585,600 (AMEND #3) | Match |
| 13 | Planning adopted | doc_2c248c52cbadfa22 p2 | 529,442 | 529,442 (slides p3 print 592,442; book used) | Match |
| 14 | Library amended | doc_9570af43463830a8 p2 | 134,910 | 134,910 | Match |
| 15 | Recorder amended | doc_9570af43463830a8 p2 | 181,383 | 181,383 | Match |
| 16 | Non-departmental amended | doc_9570af43463830a8 p2 | 122,180 | 122,180 | Match |
| 17 | Transfer to Internal Service amended | doc_9570af43463830a8 p2 | 580,534 | 580,534 | Match |
| 18 | Property tax revenue | doc_2c248c52cbadfa22 p4; doc_4d69a97b95e87bea p2 | 5,395,500 | 5,395,500 | Match |
| 19 | Sales tax revenue | doc_2c248c52cbadfa22 p4 | 3,800,000 | 3,800,000 | Match |
| 20 | Interest revenue | doc_2c248c52cbadfa22 p4; doc_4d69a97b95e87bea p2 | 500 | 815,000 ("Interest Earnings"; slides "Interest Income ... $815,000") | Mismatch |
| 21 | Fines revenue | doc_2c248c52cbadfa22 p4; doc_4d69a97b95e87bea p2 | 815,000 | 500 ("Fines & Forfeitures"; slides "Fines ... $500") | Mismatch |
| 22 | Water fund total | doc_2c248c52cbadfa22 p3 | 7,575,979 | 7,575,979 | Match |
| 23 | RDA fund total | doc_2c248c52cbadfa22 p3 | 29,786,656 | 29,786,656 | Match |
| 24 | Capital Projects fund total | doc_2c248c52cbadfa22 p3; slides p4 | 5,004,018 | 5,004,018 | Match |
| 25 | History: property tax FY23 actual | doc_2c248c52cbadfa22 p2, p4 | 3,261,171 | 3,261,171 | Match |
| 26 | History: police FY25 actual | doc_2c248c52cbadfa22 p2 | 3,252,168 | 3,252,168 | Match |

## 4. Capital projects on /budget?view=projects (all 50)

Source: FY 27 Final Budget Slides, doc_4d69a97b95e87bea, the page in the second column.

| # | Project | Page | Fund | Ours: department, amount | Source | Verdict |
|---|---|---|---|---|---|---|
| 1 | Finish construction of Slide Hill at Grove Park | 4 | general | Parks and Recreation, 64,959 | same amount and department on the slide | Match |
| 2 | Master plan design of the Robin's property | 4 | general | Parks and Recreation, 50,000 | same amount and department on the slide | Match |
| 3 | Design and construct shoreline improvement | 4 | general | Parks and Recreation, 15,000 | same amount and department on the slide | Match |
| 4 | Design and construct Utah Lake shoreline trail and bike station improvements | 4 | general | Parks and Recreation, 18,000 | same amount and department on the slide | Match |
| 5 | Shoreline improvement (Utah Lake Authority grant) | 4 | general | Parks and Recreation, 7,000 | same amount and department on the slide | Match |
| 6 | Public safety master plan and impact fee study | 4 | general | Public Safety, 60,000 | same amount and department on the slide | Match |
| 7 | Dumpster enclosures | 4 | general | Public Works, 40,000 | same amount and department on the slide | Match |
| 8 | 170 North and North Vineyard Road crosswalk | 4 | general | Public Works, 15,000 | same amount and department on the slide | Match |
| 9 | Flip the Strip in all detention basins and collector roads | 4 | general | Public Works, 125,000 | same amount and department on the slide | Match |
| 10 | Design of the 1200 North overpass bridge | 4 | general | Engineering, 500,000 | same amount and department on the slide | Match |
| 11 | Holdaway Road bike boulevard study | 4 | general | Planning, 25,000 | same amount and department on the slide | Match |
| 12 | Holdaway Fields 400 South betterment | 4 | impact | Transportation, 500,000 | same amount and department on the slide | Match |
| 13 | Traffic signal at 600 North and Main Street | 4 | impact | Transportation, 404,000 | same amount and department on the slide | Match |
| 14 | Public Works building improvements (25%) | 4 | impact | Transportation, 300,000 | same amount and department on the slide | Match |
| 15 | 1600 North Geneva Road intersection widening | 4 | impact | Transportation, 270,000 | same amount and department on the slide | Match |
| 16 | Homesteads reimbursement | 4 | impact | Transportation, 130,000 | same amount and department on the slide | Match |
| 17 | Install street lights along 170 South | 4 | impact | Transportation, 100,000 | same amount and department on the slide | Match |
| 18 | Holdaway Fields and Main Street betterment | 4 | impact | Transportation, 80,000 | same amount and department on the slide | Match |
| 19 | Concrete and electrical for two sheds | 4 | impact | Transportation, 66,000 | same amount and department on the slide | Match |
| 20 | One large shed | 4 | impact | Transportation, 43,000 | same amount and department on the slide | Match |
| 21 | One small shed | 4 | impact | Transportation, 20,000 | same amount and department on the slide | Match |
| 22 | Skate park near Vineyard City Hall (RAP tax and UORG grant) | 4 | rap | Parks and Recreation, 1,420,000 | same amount and department on the slide | Match |
| 23 | ARCH Commission RAP tax allocation | 4 | rap | Parks and Recreation, 20,000 | same amount and department on the slide | Match |
| 24 | 400 South roadway, additional cost | 5 | transport | Engineering, 100,000 | same amount and department on the slide | Match |
| 25 | Pedestrian ramp updates (HBA, Main Street and Center Street) | 5 | transport | Public Works, 75,000 | same amount and department on the slide | Match |
| 26 | Parking implementation on 300 West: restriping and design | 5 | transport | Public Works, 50,000 | same amount and department on the slide | Match |
| 27 | Lift Station 2 upgrade (carried over from FY25) | 5 | wastewater | Wastewater, 600,000 | same amount and department on the slide | Match |
| 28 | Public Works building improvements | 5 | wastewater | Wastewater, 250,000 | same amount and department on the slide | Match |
| 29 | Sewer system improvements | 5 | wastewater | Wastewater, 150,000 | same amount and department on the slide | Match |
| 30 | Storage building at Lift Station 2 | 5 | wastewater | Wastewater, 125,000 | same amount and department on the slide | Match |
| 31 | Fiber to lift stations (rolled over) | 5 | wastewater | Wastewater, 15,000 | same amount and department on the slide | Match |
| 32 | Central Utah Water Conservancy District take-down fee | 5 | water | Water, 1,850,000 | same amount and department on the slide | Match |
| 33 | 22 Lake Bottom water shares from Orem | 5 | water | Water, 554,500 | same amount and department on the slide | Match |
| 34 | Water shares | 5 | water | Water, 300,000 | same amount and department on the slide | Match |
| 35 | Public Works building improvements | 5 | water | Water, 250,000 | same amount and department on the slide | Match |
| 36 | Secondary water master plan | 5 | water | Water, 100,000 | same amount and department on the slide | Match |
| 37 | Pressurized irrigation pond pump upgrade | 5 | water | Water, 96,000 | same amount and department on the slide | Match |
| 38 | Concrete aprons around hydrants | 5 | water | Water, 60,000 | Public Works, 60,000 ("Concrete aprons around hydrants $ 60,000 Public Works") | Mismatch: department |
| 39 | Backflow software | 5 | water | Water, 15,000 | same amount and department on the slide | Match |
| 40 | Trailer for backhoe | 5 | water | Water, 10,000 | same amount and department on the slide | Match |
| 41 | Environmental remediation, Anderson Geneva east and west | 6 | rda | Redevelopment, 6,000,000 | same amount and department on the slide | Match |
| 42 | Rail spur realignment: design and construction | 6 | rda | Redevelopment, 3,500,000 | same amount and department on the slide | Match |
| 43 | Vineyard Beach improvements: design (TRCC grant and Flagship rebate) | 6 | rda | Redevelopment, 3,372,441 | same amount and department on the slide | Match |
| 44 | Vineyard Connector promenade overpass (UDOT) | 6 | rda | Redevelopment, 2,200,000 | same amount and department on the slide | Match |
| 45 | Lift Station 4 (FY27 portion) | 6 | rda | Redevelopment, 1,300,000 | same amount and department on the slide | Match |
| 46 | Traffic signals at 600 North and Main Street and 400 North and Mill Road (carried over) | 6 | rda | Engineering, 625,000 | same amount and department on the slide | Match |
| 47 | 400 North traffic signal: design and construction | 6 | rda | Redevelopment, 625,000 | same amount and department on the slide | Match |
| 48 | Public Works building improvements | 6 | rda | Redevelopment, 400,000 | same amount and department on the slide | Match |
| 49 | Pedestrian enhancements (flashers) | 6 | rda | Redevelopment, 55,000 | same amount and department on the slide | Match |
| 50 | City-wide economic development strategic plan | 6 | rda | Redevelopment, 35,000 | same amount and department on the slide | Match |

## 5. Calendar meetings (20)

Source: CivicClerk `GET /v1/Events/<id>` (start time is the city's wall clock); where an agenda is posted, its first page was read too.

| # | CivicClerk event | Meeting | Ours: date, time | Ours: place | Source | Verdict |
|---|---|---|---|---|---|---|
| 1 | 1705 | ARCH Commission | 2026-09-24 18:00 | 125 S Main St, VINEYARD, Utah | same; agenda doc_a9ee7a4c2dc85ad6 p1 gives the same time | Match |
| 2 | 1709 | Youth Council | 2026-10-06 18:00 | 125 S Main St, Vineyard, Utah | same; agenda doc_41d03e4158945f34 p1 gives the same time | Match |
| 3 | 1516 | Planning Commission | 2026-10-07 19:00 | City Council Chambers, 125 South Main Street, Vineyard, Utah | same; agenda doc_5a3a5e25ca22df8d p1 gives the same time | Match |
| 4 | 1707 | Development Review Committee | 2026-10-08 09:00 | 125 S. Main St., Vineyard, UT | same; agenda doc_dcbbef4e88a5f1e1 p1 gives the same time | Match |
| 5 | 1261 | Vineyard Cares Coalition | 2026-10-08 18:00 | 125 South Main Street, Vineyard, UT | same | Match |
| 6 | 1710 | Active Transportation Commission | 2026-10-08 18:00 | 707 E Mill Road, , Vineyard, UT | 2026-10-08 18:00; 707 E Mill Road, / HBA Building Suite 202, / Vineyard, UT (agenda doc_90d40786d5c3621c p1: "in the HBA Building") | Mismatch: place (street line missing) |
| 7 | 1443 | City Council | 2026-10-13 18:00 | City Council Chambers, 125 South Main Street | same; agenda doc_f4ae1addeca92d54 p1 gives the same time | Match |
| 8 | 1706 | Redevelopment Agency Board | 2026-10-13 18:00 | City Council Chambers, Vineyard, UT | 2026-10-13 18:00; City Council Chambers / 125 South Main Street / Vineyard, UT (agenda doc_eec450a90e31894d p1) | Mismatch: place (street line missing) |
| 9 | 1589 | Library Board | 2026-10-20 18:00 | 125 South Main Street, Vineyard, UT | same | Match |
| 10 | 1455 | City Council | 2026-10-27 18:00 | City Council Chambers, 125 South Main Street | same | Match |
| 11 | 1711 | ARCH Commission | 2026-10-29 18:00 | (no place listed) | same | Match |
| 12 | 1517 | Planning Commission | 2026-11-04 19:00 | City Council Chambers, 125 South Main Street, Vineyard, Utah | same | Match |
| 13 | 1708 | Development Review Committee | 2026-11-05 09:00 | 125 S. Main St., Vineyard, UT | same | Match |
| 14 | 1444 | City Council | 2026-11-10 18:00 | City Council Chambers, 125 South Main Street | same | Match |
| 15 | 1622 | Vineyard Cares Commission | 2026-11-12 18:00 | 125 South Main Street, Vineyard, UT | same | Match |
| 16 | 1660 | Joint Meeting with Orem City | 2026-11-17 12:30 | City Council Conference Room, Orem, UT | 2026-11-17 12:30; City Council Conference Room, / 56 N State Street / Orem, UT | Mismatch: place (street line missing) |
| 17 | 1445 | City Council | 2026-12-08 18:00 | City Council Chambers, 125 South Main Street | same | Match |
| 18 | 1518 | Planning Commission | 2026-12-02 19:00 | City Council Chambers, 125 South Main Street, Vineyard, Utah | same | Match |
| 19 | 1425 | Active Transportation Commission (copy titled 12-09-2025) | 2026-12-08 17:30 | 125 South Main Street, Vineyard, UT | same | Match |
| 20 | 1442 | City Council | 2026-09-08 18:00 | City Council Chambers, 125 South Main Street | same; agenda doc_10b5652cdde3ddd7 p1 gives the same time | Match |

## 6. People (15)

Source: the stored City Staff directory, doc_394eaf730f06b496 p1 ("City staff directory (current)", read from https://www.vineyardutah.gov/government/city_staff.php on October 5, 2026). The city page itself refuses the Diagnostics runner (HTTP 403), so the stored copy is the record. Sample: Python `random.seed(20261011)`, 15 of the staff entries in /api/people sorted by slug.

| # | Name | Ours: title; email; phone; department | Source | Verdict |
|---|---|---|---|---|
| 1 | Kelly Kloepfer | Business Licensing; none; (801) 226-1929; Building | same | Match |
| 2 | Ed Kennedy | Code Enforcement Officer; none; none; Community | same | Match |
| 3 | Zach Cutler | Utility Billing Clerk; none; none; Finance | same | Match |
| 4 | Devan Peterson | Environmental Utilities Manager; none; none; Public Works | same | Match |
| 5 | Clint Roundy | Streets & Stormwater Operator Crew Lead; none; none; Public Works | same | Match |
| 6 | Bailey Bushman | Recreation Coordinator; none; none; Parks & Recreation | same | Match |
| 7 | Austin Davis | Senior Building Inspector; none; none; Building | same | Match |
| 8 | Zach Baty | Recreation Manager; none; none; Parks & Recreation | same | Match |
| 9 | Justine Marshall | Project Manager; none; none; Public Works | same | Match |
| 10 | Tom Popadich | Street-Stormwater Operator; none; none; Public Works | same | Match |
| 11 | Aaron Plake | Public Works Inspector; none; none; Engineering & Planning | same | Match |
| 12 | Tim Dye | Public Works Technician; none; none; Public Works | same | Match |
| 13 | Charles Larsen | Street-Stormwater Operator; none; none; Public Works | same | Match |
| 14 | Kinsli McDermott | MS4 & Stormwater Inspector; none; none; Engineering & Planning | same | Match |
| 15 | Brailee Tyler | Communications/Media Specialist; braileet@vineyardutah.gov; none; Community | same | Match |

## Tests and chat suite

- tests/audit-2026-10.test.ts: each motion, budget, project and place case above, with the source text.
- ingest/tests/test_people.py and ingest/tests/test_units.py: department casing, staff count, CivicClerk address lines.
- tests/chat-suite/cases.json: budget-interest-revenue, budget-fines-revenue, votes-mayor-pro-tem-2026-04-14, votes-rda-tamez-mover, votes-holdaway-fields-amendment, meetings-orem-joint-place.

The motion fixes reach the live site when the next sync re-reads the minutes (parser version 18); the meeting places when the next CivicClerk sync runs.
