# SAP Concur Expense — Standard Accounting Extract (SAE) V3

## Source

- **Original document:** `EXP_SPEC_SAE_V3.pdf`
- **Document title:** *Expense: Standard Accounting Extract, Version 3 Specification*
- **Last revised:** April 27, 2018
- **Purpose:** Technical reference for consuming SAP Concur Expense SAE V3 in a downstream General Ledger (GL), Accounts Payable (AP), payroll, payment, or reconciliation integration.

> This is a structured Markdown conversion focused on the SAE file layout, interface requirements, field groups, and implementable validation rules. It retains the functional specifications needed to design a parser and validation layer; columns labelled **Future Use** are intentionally summarized rather than individually listed.

---

# 1. Interface Overview

## 1.1 Purpose and downstream use

SAE is a broad financial data feed intended as source data for import into a client GL or AP system. The client must build a bridge/interface program that selects the required fields, transforms them as necessary, and imports the result to the financial system.

## 1.2 Transport and output format

- SAP Concur encrypts data in transit.
- Default output is a pipe-delimited (`|`) text file.
- An SAE output normally has one header record followed by detail records.
- When the extract definition is configured for multiple output files, Concur produces a ZIP containing multiple `.txt` files.
- Every data element is present in every detail row. Fields not applicable to the row are blank.
- File header ensures an output is generated even if there are no extractable reports.

## 1.3 Recommended output settings

| Setting | Requirement / recommendation |
|---|---|
| Text case | Use **As Entered**. Avoid forced upper/lower case, which can alter characters (for example German `ß` becoming `SS`) and potentially exceed configured field lengths. |
| Decimal places | Configure/confirm the entity setting. New entities from Service Update 53 use four decimal places (`.0001`) for amount fields; legacy entities may differ. |
| Date format | Use `yyyy-MM-dd` unless a field expressly specifies a different format. |
| Invoice Pay scheduling | Schedule SAE **daily** so the extract cycle aligns with Invoice Pay’s daily cycle. |

---

# 2. File Grammar and Data Lifecycle

## 2.1 Record grammar

```text
Header record: EXTRACT|BatchDate|RecordCount|JournalAmountTotal|BatchID
Detail record: DETAIL|BatchID|BatchDate|SequenceNumber|<columns 5 through 400>
```

## 2.2 Header fields

| Position | Field | Type / format | Maximum length | Requirement |
|---:|---|---|---:|---|
| 1 | Constant | Alphanumeric, literal `EXTRACT` | 7 | Must equal `EXTRACT`. |
| 2 | Batch Date | Date, `yyyy-MM-dd` | 10 | Extract batch date. |
| 3 | Record Count | Numeric | 10 | Count of detail records in the file. |
| 4 | Journal Amount Total | Money | 23 | Sum of all journal-amount values in journal rows. |
| 5 | Batch ID | Numeric | 13 | Sequential identifier starting at 1. |

## 2.3 Detail-prefix fields

| SAE column | Field | Type / format | Requirement |
|---:|---|---|---|
| 1 | Constant | Alphanumeric | Must equal `DETAIL`. |
| 2 | Batch ID | Numeric | Must match header Batch ID. |
| 3 | Batch Date | Date, `yyyy-MM-dd` | Must match header Batch Date. |
| 4 | Sequence Number | Numeric | Detail line sequence generated when the file is created. |

## 2.4 When values are saved for SAE

SAE values are persisted at two different points; this is critical for reconciliation and testing.

| Data set | Snapshot point | Integration consequence |
|---|---|---|
| File Header | Extract generation | Uses values current when the job runs. |
| Batch Data | Extract generation | Uses values current when the job runs. |
| Employee Data | Extract generation | Employee changes made before extraction are reflected without re-saving the report. |
| Report, Entry, Journal, Allocation, and other non-employee data | Processor approval | Values must be saved as part of the approved report before extraction. Later master-data/configuration changes do not retroactively update those values. |

**Example implication:** If an expense report was processor-approved with account code `123` and cost center `ABC`, then the account code configuration is changed to `456` and employee cost center to `DEF`, the report/journal snapshot retains `123` and `ABC`; employee-level values can reflect the later value at extraction time.

---

# 3. Logical Data Structure

The SAE V3 detail layout has 400 positions. The following map groups fields by business object.

| SAE column range | Logical section | Primary content |
|---:|---|---|
| 5–18 | Employee | Employee identity, organisation, payment-bank details, net-tax journal value |
| 19–60 | Report | Report identifiers, currency, approval/submission data, report organisation and custom dimensions |
| 61–128 | Report Entry | Expense line, dates, currency, receipt/attendee values, entry-level org/custom dimensions, expense amounts, payment code |
| 129–157 | Credit Card | Card account and transaction information, merchant and reconciliation values |
| 158–162 | Entry Location | Expense location and domestic/foreign classification |
| 163–170 | Journal | Payer/payee, GL account, debit/credit, signed journal amount |
| 171–176 | Car Mileage | Distance, passenger, vehicle, card sales-tax/vendor values |
| 177–188 | Cash Advance | Advance amount, currency, issuance/request data, transaction type, disbursement method |
| 189–211 | Allocation | Allocation key, percentage, custom allocation dimensions, adjusted net tax |
| 212–224 | Travel Allowance | Allowance configuration and meal/lodging indicators/tax adjusted values |
| 225–238 | VAT Tax | Tax authority, tax/reclaim amounts, sources, tax/reclaim codes |
| 239–245 | Assigned Travel Request | Request ID, name, totals, trip dates, authorisation date |
| 246–250 | Additional VAT / payment | Entry-level tax totals/net amounts and payment type |
| 251–253 | Company Bill Statement | Card-program type and statement period |
| 254–263 | Expense Pay | Funding account values, estimated payment date, funding trace, system allocation flag |
| 264–290 | Additional Employee | Login/email and employee custom dimensions |
| 291–310 | Employee Banking | Account status, banking details, bank country/currency |
| 311–326 | Additional Report | Personal/claimed/paid/due totals, report type, adjusted tax, report dates |
| 327–333 | Additional Cash Advance | Returned/utilized amounts |
| 334–346 | Additional Report Entry | Location, billable flag, route, country/subdivision, XML receipt UUID/supplier tax ID |
| 347–356 | Additional VAT | Allocation tax totals and merchant tax ID |
| 357–363 | Request | Authorization-request fields |
| 364–400 | Future Use | Reserved positions; preserve column count and do not repurpose. |

---

# 4. Field Catalogue

## 4.1 Employee data — columns 5–18

| Col. | Source / field | Description and constraints |
|---:|---|---|
| 5 | `CT_EMPLOYEE.EMP_ID` | Employee ID; alphanumeric, max 48. Often used as AP vendor or payroll ID. |
| 6–8 | `LAST_NAME`, `FIRST_NAME`, `MI` | Employee name fields; max 32, 32, and 1. |
| 9 | `CUSTOM21` | Employee group ID; client-defined, max 48. |
| 10–15 | `ORG_UNIT1`–`ORG_UNIT6` | Employee organisational dimensions; client-defined, max 48 each. |
| 16 | `CT_EMP_BANK_ACCOUNT.ACCOUNT_NUMBER` | EFT/ACH account number; alphanumeric, max 100. Included only when specifically requested because it is sensitive. |
| 17 | `CT_EMP_BANK_ACCOUNT.ROUTING_NUMBER` | EFT/ACH routing number; alphanumeric, max 100. Included only when specifically requested. |
| 18 | `AMT_NET_TAX_TOTAL_RECLAIM` | Gross journal less reclaimable tax, or net journal plus non-reclaimable tax; money, max 23; calculated at field-generation time. |

> Employee organisational/accounting data is also copied to report and/or entry level so point-in-time accounting values can be used downstream.

## 4.2 Report data — columns 19–60

| Col. | Source / field | Description and constraints |
|---:|---|---|
| 19 | `CT_REPORT.REPORT_ID` | Unique report ID; alphanumeric, max 32; can be used as AP voucher number. |
| 20 | `CT_REPORT.RPT_KEY` | System-generated numeric report key, max 48; smaller alternative identifier. |
| 21 | `CT_LEDGER.LEDGER_CODE` | External accounting system / ledger ID; max 20. |
| 22 | `CT_CURRENCY.ALPHA_CODE` | Employee reimbursement currency; ISO alpha, 3 characters. |
| 23 | `CT_COUNTRY_LANG.NAME` | Employee home-country name, localized for ledger language; max 64. |
| 24 | `CT_REPORT.SUBMIT_DATE` | Submission date; `yyyy-MM-dd`. |
| 25 | `CT_REPORT.USER_DEFINED_DATE` | User-defined report date; `yyyy-MM-dd`. |
| 26 | `CT_REPORT.RPT_PAYMENT_PROCESSING_DATE` | Date the report completed approvals and was ready for payment/extract; `yyyy-MM-dd`. |
| 27 | `CT_REPORT.NAME` | Employee-entered report name; max 40. |
| 28 | `CT_REPORT.IMAGE_REQUIRED` | Receipt/image required flag: `Y`/`N`. |
| 29 | `CT_REPORT.HAS_VAT_ENTRY` | At least one VAT entry flag: `Y`/`N`. |
| 30 | `CT_REPORT.HAS_TA_ENTRY` | At least one travel allowance entry flag: `Y`/`N`. |
| 31–32 | `TOTAL_POSTED_AMOUNT`, `TOTAL_APPROVED_AMOUNT` | Report totals in reimbursement currency; money, max 23. |
| 33 | `CT_POLICY_LANG.NAME` | Report policy name; max 64. |
| 34 | `CT_REPORT_ENTRY.BUDGET_ACCRUAL_DATE` | Budget Insight accrual date; `yyyy-MM-dd`; only for clients with Budget Insight. |
| 35–40 | `CT_REPORT.ORG_UNIT_1`–`ORG_UNIT_6` | Point-in-time report-level org dimensions; client-defined, max 48 each. Used as GL string segments; natural account is column 167. |
| 41–60 | `CT_REPORT.CUSTOM1`–`CUSTOM20` | Client-defined report dimensions, max 48 each. Many are copies of the associated employee custom fields; Custom17 can be AP Vendor ID in CES Standard. |

## 4.3 Report entry data — columns 61–128

| Col. | Source / field | Description and constraints |
|---:|---|---|
| 61 | `CT_REPORT_ENTRY.RPE_KEY` | Unique numeric report-entry key; max 13. |
| 62 | `CT_REPORT_ENTRY.TRANSACTION_TYPE` | `REG` = regular/non-itemized or allocated; `CHD` = child itemization/allocation. Parent itemized/allocated entries are excluded. |
| 63 | `CT_EXPENSE_TYPE_LANG.NAME` | Expense type name; max 64. |
| 64 | `CT_REPORT_ENTRY.TRANSACTION_DATE` | Expense/receipt date; `yyyy-MM-dd`. |
| 65 | `CT_CURRENCY.ALPHA_CODE` | Spend or invoice currency; ISO alpha, 3 characters. |
| 66–67 | `EXCHANGE_RATE`, `EXCHANGE_RATE_DIRECTION` | Spend-to-reimbursement exchange rate and direction: `M` = multiply, `D` = divide. |
| 68 | `IS_PERSONAL` | Personal expense flag: `Y`/`N`. |
| 69–71 | `DESCRIPTION`, vendor name, `VENDOR_DESCRIPTION` | Entry description and supplier fields; max 64 each. |
| 72 | `RECEIPT_RECEIVED` | Processor-reviewed receipt flag: `Y`/`N`. |
| 73 | `RECEIPT_TYPE` | `T` = tax receipt; `R` = regular receipt; `N` = no receipt. |
| 74–76 | attendee totals | Numeric totals by Employee/This Employee, Spouse, Business Guest; calculated at extract generation. |
| 77–82 | `ORG_UNIT_1`–`ORG_UNIT_6` | Entry-level organisational dimensions, max 48; support cross-charging; can copy from employee/report. |
| 83–122 | `CUSTOM1`–`CUSTOM40` | Client-defined entry dimensions, max 48 each; Custom10 may be Project in CES Standard. |
| 123 | `TRANSACTION_AMOUNT` | Expense amount in spend currency; money, max 23. |
| 124 | `POSTED_AMOUNT` | Expense amount in reimbursement currency; money, max 23. |
| 125 | `APPROVED_AMOUNT` | Approved amount in reimbursement currency; money, max 23. |
| 126–127 | payment code | Payment type code (max 4) and name (max 80). |
| 128 | reimbursement type | `1` = reimbursed through Expense Pay; blank = not Expense Pay. |

## 4.4 Credit card data — columns 129–157

| Col. | Field | Description and constraints |
|---:|---|---|
| 129 | Billing Date | Card-vendor bill date; `yyyy-MM-dd`. |
| 130–131 | Billed card account / description | Unencrypted card account number and liability-account description; max 255 each. Treat as sensitive data. |
| 132–136 | Card import/reconciliation IDs | Journal import key, vendor reference, transaction key, CCT type, transaction ID. CCT type includes `ANF`, `CAV`, `CCF`, `CHG`, `FNC`, `LAF`, `NSF`, `PAY`, `RPE`. |
| 137–143 | Amounts, currencies, dates | Transaction/tax/posted amounts; ISO 3-character currencies; merchant and posted dates. |
| 144–151 | Merchant/card metadata | Merchant description (42), MCC (5), merchant name (128), city (40), state (32), country (2), merchant reference (15), billing type (2). |
| 152 | Billing-to-employee FX rate | Numeric, max 23. |
| 153 | Billing Amount | Company-card amount due for the detail row; money, max 23. |
| 154–156 | Individual card / DBA | Individual account number, name-on-card, and merchant DBA. |
| 157 | Acquirer Reference Number | Reconciliation reference from the card feed; numeric, max 50. |

## 4.5 Location and journal data — columns 158–170

| Col. | Field | Description and constraints |
|---:|---|---|
| 158–159 | Spend location country / subdivision | ISO 2-character country; subdivision max 6. |
| 160 | Foreign/domestic flag | `FRGN` = outside home country; `HOME` = home country; `OOSD` = home country but outside employee home subdivision. |
| 161 | Market Code | Card-account market/region code; max 255. |
| 162 | Processor Reference Number | Card reconciliation reference; numeric, max 64. |
| 163–166 | Journal payer/payee type and code | Payer/payee types are Company or Employee; payment-code names max 80. |
| 167 | `CT_JOURNAL.ACCOUNT_CODE` | Expense account / CBCP personal clearing account / company-billed card account code; max 48. |
| 168 | `DEBIT_OR_CREDIT` | `DR` or `CR`. |
| 169 | `AMOUNT` | Signed journal amount; zero = `0`, debit can be `+50.00`, credit can be `-50.00`; money, max 23. |
| 170 | `RPJ_KEY` | Numeric report-journal key; max 10. |

## 4.6 Mileage and cash advance data — columns 171–188

| Col. | Field | Description and constraints |
|---:|---|---|
| 171–174 | Mileage | Business/personal distance, passenger count, vehicle ID. |
| 175–176 | Card sales tax / vendor | Card sales tax amount and associated card vendor. |
| 177 | Cash advance request amount | Amount in cash-advance transaction currency; money, max 23. |
| 178–182 | Advance currencies and FX | Transaction currency ISO alpha/numeric, exchange rate, reimbursement currency ISO alpha/numeric. |
| 183 | Issued Date | `yyyy-MM-dd`. |
| 184 | Cash advance payment code | Method used to pay employee; max 80. |
| 185 | Cash advance transaction type | `1` = issue or return to CA administrator; `2` = application (including CA-return expense); `3` = system cash advance / balance carry-forward. |
| 186–187 | Request date / cash advance key | Request date and unique numeric system key. |
| 188 | Disbursement method | `0` = non-Expense Pay; `1` = Expense Pay. |

## 4.7 Allocation data — columns 189–211

| Col. | Field | Description and constraints |
|---:|---|---|
| 189 | `ALLOC_KEY` | System-generated numeric allocation key. |
| 190 | `PERCENTAGE` | Percentage allocated to this allocation record; numeric, max 11. |
| 191–210 | `CT_ALLOCATION.CUSTOM1`–`CUSTOM20` | Client-defined allocation dimensions; max 48 each. |
| 211 | Adjusted journal net tax | Gross journal amount less total tax; calculated at extract generation; money, max 23. |

### Allocation mapping rule

If users do not edit allocations, system allocation rows may have blank allocation custom fields unless defaults are configured.

1. **Recommended:** configure allocation custom fields to copy default values from the employee profile, report header, or expense entry.
2. **If defaults are not configured:** the receiving AP system must fall back to the corresponding source at expense-entry level. Example: if Allocation Custom1 (column 191) is blank for an unallocated expense, map from Report Entry Custom1 (column 83), not from the blank allocation field.

## 4.8 Travel allowance data — columns 212–224

| Col. | Field | Description and constraints |
|---:|---|---|
| 212 | Reimbursable meal/lodging type | `M` = meals; `L` = lodging; `C` = combined. |
| 213–215 | Allowance limits | Display limit, allowance limit, allowable threshold; money, max 23. Population depends on travel allowance configuration. |
| 216 | Fixed meal/lodging type | `M` = meals; `L` = lodging. |
| 217–218 | Base / allowance amount | Daily base amount and adjusted reimbursement amount. |
| 219 | Overnight flag | `Y`/`N`; indicates overnight stay with friend/family rather than lodging. |
| 220–222 | Breakfast/lunch/dinner provided | Values: `NPR` (no prorate), `PRO` (prorated), `TAX` (tax receipt). German-market values: `BSE`, `CVT`, `WRK`, `INC`, `EXT`. |
| 223–224 | Tax adjusted amounts | Total tax adjusted posted amount and reclaim adjusted amount. |

### Travel allowance configuration matrix

| Configuration | Display limit | Allowance limit | Allowable threshold |
|---|---|---|---|
| No limit / single rate | Rate amount | Null | Rate amount |
| Limit / single rate | Rate amount | Rate amount | Null |
| No limit / two rates | Company rate | Null | Government rate |
| Limit / two rates | Company rate | Company rate | Government rate |

## 4.9 VAT tax data — columns 225–238

| Col. | Field | Description and constraints |
|---:|---|---|
| 225–226 | Tax authority name / label | Tax authority name (50) and tax label (5). |
| 227–228 | Tax amount | Spend-currency and reimbursement-currency tax amounts. |
| 229 | Tax source | `CARD`, `USER`, `SYST`, or `PROC`. |
| 230–231 | Reclaim amount | Reclaimable tax in spend and reimbursement currencies. |
| 232 | Tax code | Tax code attached to tax authority/expense type; max 20. |
| 233 | Domestic reclaim flag | `Y` when the tax configuration is a reclaimable local jurisdiction. |
| 234–235 | Adjusted tax / reclaim | Calculated from approved amount, not total amount. |
| 236 | Reclaim code | Reclaim code from tax definition; max 20. |
| 237 | Reclaim transaction adjusted amount | Approved-based tax in spend currency. |
| 238 | Allocation reclaim code | Allocation reclaim code; max 20. |

## 4.10 Travel request, additional tax, company bill, Expense Pay — columns 239–263

| Range | Core fields |
|---:|---|
| 239–245 | Assigned authorization-request ID/name, posted/approved totals, start/end/authorized dates. |
| 246–249 | Entry total tax posted, net tax (`Posted Amount − Total Tax Posted Amount`), total reclaim adjusted, and net reclaim adjusted (`Approved Amount − Total Reclaim Adjusted Amount`). |
| 250 | Report-entry payment type name. |
| 251–253 | Card program type and statement start/end dates. |
| 254–255 | Expense Pay funding cash-account and liability-account codes. |
| 256 | Estimated payment date: calculated based on payment state; `Assigned` and `Sent` are four weekdays after their respective dates; `Confirmed` uses payment engine estimate; `Aborted`, `Failed Account`, and `Pending Confirmation` are blank. Format `YYYY/MM/DD`. |
| 257 | Funding trace number; character, max 30. |
| 258–259 | Requested cash-advance disbursement date and cash-advance request name. |
| 260 | System allocation flag: `Y`/`N`; `Y` denotes system-generated/default allocation, not user-entered. |
| 261–263 | Future Use. |

## 4.11 Additional employee and banking data — columns 264–310

| Range | Core fields |
|---:|---|
| 264–265 | Employee login ID (128) and email address (255). |
| 266–285 | Employee Custom1–Custom20; client-defined, max 48 each. |
| 286–290 | Future Use. |
| 291 | Employee banking account active: `Y` active / `N` inactive. |
| 292 | Bank account type: `CHCK` checking or `SAVE` savings (savings is US only; non-US normally `CHCK`). |
| 293–304 | Account name, bank name/branch/address/city/region/postal/country/tax ID/residency/status. |
| 305 | Bank account currency; ISO alpha. Supported values listed: `USD`, `EUR`, `AUD`, `GBP`; blank defaults to `USD`. |
| 306–310 | Future Use. |

## 4.12 Additional report, entry, tax, and request data — columns 311–363

| Range | Core fields |
|---:|---|
| 311–318 | Report total personal, claimed, due employee, due company card, rejected, company paid, due company, confirmed paid. |
| 319–320 | Actual due employee / company card preserve negative values. In contrast, columns 313–314 return zero when negative for payment systems that cannot deduct money. |
| 321 | Report type: blank regular; `RR` Expense Assistant auto-created regular report; `CR` Central Reconciliation; `SR` Statement report. |
| 322–323 | Total tax adjusted and net adjusted tax. |
| 324–325 | Report start/end dates, optionally imported from Trip or entered on the header. |
| 326 | Future Use. |
| 327–329 | Cash advance returned amount, return-received flag, and utilized amount. |
| 330–333 | Future Use. |
| 334–342 | Location city, billable flag, from/to location, location name, country/subdivision, XML receipt UUID (36; stored Binary(16)), supplier tax ID (64). |
| 343–346 | Future Use. |
| 347–351 | Allocation total tax/reclaim amounts (transaction, posted, and adjusted forms). |
| 352 | Merchant tax ID; source precedence: E-Receipt v4 tax data, then company-card transaction, then ExpenseIt OCR transaction. |
| 353–356 | Future Use. |
| 357–363 | Authorization request name, posted/approved totals, start/end/authorized dates, request ID. |

---

# 5. Data Validation Rules and Control Requirements

This section converts the SAE specification into actionable validation requirements for a receiving interface. It distinguishes **must-pass technical checks** from **recommended accounting/business controls**.

## 5.1 File-level technical validation

| ID | Severity | Validation requirement | Implementation rule |
|---|---|---|---|
| F-01 | Error | Header existence | First row must exist and column 1 must be `EXTRACT`. |
| F-02 | Error | Header width | Header must contain exactly 5 pipe-delimited fields. |
| F-03 | Error | Detail marker | Every subsequent business row must have `DETAIL` in position 1. |
| F-04 | Error | Detail width | Each `DETAIL` row must preserve all positions through SAE column 400. Do not drop trailing blank future-use columns where positional parsing requires them. |
| F-05 | Error | Batch consistency | Detail Batch ID / Batch Date must equal header Batch ID / Batch Date. |
| F-06 | Error | Date syntax | Header and standard date columns must match `yyyy-MM-dd`; estimated payment date (column 256) is `YYYY/MM/DD`. |
| F-07 | Error | Record-count reconciliation | Header Record Count must equal the number of parsed `DETAIL` rows. |
| F-08 | Error / tolerance | Journal total reconciliation | Recalculate the sum of populated journal amounts (column 169) and compare to Header Journal Amount Total. Define an agreed rounding tolerance compatible with configured decimal precision. |
| F-09 | Warning | Sequence quality | Detail sequence numbers should be numeric and unique within the batch; report gaps or duplicates. |
| F-10 | Error | Reserved fields | Keep positions 261–263, 286–290, 306–310, 326, 330–333, 343–346, 353–356, and 364–400 reserved. Never assign local business meanings. |

## 5.2 Domain, type, length, and format validation

| ID | Severity | Validation requirement |
|---|---|---|
| D-01 | Error | Validate numeric fields as numbers; reject non-numeric values where the layout declares Numeric. |
| D-02 | Error | Validate money fields as signed decimals and enforce the interface maximum of 23 characters / stated decimal setting. |
| D-03 | Error | Enforce maximum lengths on nonblank values, especially client-defined codes (normally 48), IDs, and bank/card values. |
| D-04 | Error | Validate ISO alpha currencies as three characters and country codes as two characters where specified. |
| D-05 | Error | Validate Boolean flags (`Y`/`N`) for report image/VAT/TA, personal, receipt received, banking active, system allocation, cash advance return received, and similar fields. Blank is permitted only if the relevant data is not applicable. |
| D-06 | Error | Validate journal debit/credit against `DR` or `CR`; preserve the signed amount in column 169 rather than assuming absolute values. |
| D-07 | Error | Validate exchange-rate direction: `M` or `D` when exchange rate is populated. |
| D-08 | Error | Validate report-entry transaction type: `REG` or `CHD`. Do not expect parent itemized/allocated rows. |
| D-09 | Error | Validate receipt type as `T`, `R`, or `N` when populated. |
| D-10 | Error | Validate tax source as `CARD`, `USER`, `SYST`, or `PROC` when populated. |
| D-11 | Error | Validate foreign/domestic classification as `FRGN`, `HOME`, or `OOSD` when populated. |
| D-12 | Error | Validate cash-advance transaction type as `1`, `2`, or `3` when populated. |
| D-13 | Error | Validate report type as blank, `RR`, `CR`, or `SR` when populated. |
| D-14 | Error | Validate travel-allowance meal flags against allowed values: `NPR`, `PRO`, `TAX`, `BSE`, `CVT`, `WRK`, `INC`, `EXT`. |
| D-15 | Warning | Validate employee bank currency against supported documented values (`USD`, `EUR`, `AUD`, `GBP`) if supplied; blank defaults to `USD`. |

## 5.3 Referential and hierarchy validation

| ID | Severity | Validation requirement | Implementation rule |
|---|---|---|---|
| R-01 | Error | Report identity | Every financial/journal line expected for a report must carry a nonblank Report ID (19) and/or Report Key (20). Use Report ID as the primary business key; use Report Key for compact numeric correlation. |
| R-02 | Error | Entry identity | For report-entry/journal rows, Report Entry Key (61) should be present when the row represents an entry. |
| R-03 | Error | Journal identity | A populated Journal Amount (169) must be accompanied by Journal Key (170), account code (167), and debit/credit (168). |
| R-04 | Error | Allocation integrity | If allocation information is used, Allocation Key (189) and Percentage (190) must be populated for allocation records. Sum allocation percentages by allocated entry according to agreed tolerance/precision. |
| R-05 | Warning | Allocation fallback | If allocation custom dimensions are blank on system/unallocated allocations, retrieve the corresponding entry-level source/custom field rather than treating the blank as a valid final accounting dimension. |
| R-06 | Warning | Org dimension mapping | Map organisational dimensions at the correct point-in-time level: entry-level values for cross-charged expenses; report-level snapshot where entry values are not applicable; employee values only for employee master-data use. |
| R-07 | Error | Ledger dimensional completeness | Validate the derived downstream GL string has all required organisation/custom segments and natural account (journal Account Code, column 167). |

## 5.4 Financial and arithmetic controls

| ID | Severity | Validation requirement | Implementation rule |
|---|---|---|---|
| A-01 | Error | File journal balance/control total | Reconcile the calculated total of journal amount values to Header Journal Amount Total. |
| A-02 | Warning | Currency conversion reasonableness | When spend and reimbursement currencies differ, verify posted amount (124) can be explained by transaction amount (123), exchange rate (66), and direction (67), subject to Concur rounding. |
| A-03 | Error | Tax net amount | Where applicable, validate `Net Tax Amount` (247) = Posted Amount (124) − Total Tax Posted Amount (246). |
| A-04 | Error | Net reclaim adjusted amount | Where applicable, validate column 249 = Approved Amount (125) − Total Reclaim Adjusted Amount (248). |
| A-05 | Warning | Approved versus posted amount | Flag approved amounts greater than posted amounts unless an agreed business scenario permits it. |
| A-06 | Warning | Report total reconciliation | Reconcile report-level posted/approved/claimed/personal totals to grouped detail rows where the selected SAE scope and accounting configuration permit a direct comparison. |
| A-07 | Error | Payment-safe amounts | Use columns 313 and 314 for payment interfaces that cannot process deductions because they return zero rather than negative values. Use columns 319 and 320 when the actual signed due value is required. |
| A-08 | Warning | Credit-card reconciliation | Use acquirer reference (157), processor reference (162), transaction ID (136), and vendor reference (133) for duplicate/reconciliation controls as available. |

## 5.5 Cash advance and balance-due controls

| ID | Severity | Validation requirement | Implementation rule |
|---|---|---|---|
| C-01 | Error | Cash advance issue | For transaction type `1`, expect Company as payer, Employee (or CBCP corporate card for CBCP ATM case) as payee, `DR`, and a clearing account code. |
| C-02 | Error | Cash advance application | For transaction type `2`, expect Employee as payer, Company as payee, `CR`, and a negative/signed credit journal amount. |
| C-03 | Warning | Cash advance recovery | Validate that application records offset the applied cash-advance value and reduce employee reimbursement appropriately. |
| C-04 | Warning | Balance Due Management | A balance-due tracking issuance appears similarly to cash advance, but uses Cash Advance Transaction Type `3`; Report ID/Key identify the source report. Prepare GL/AP logic to recognize this. |
| C-05 | Warning | Multiple-expense offset order | Cash-advance offset prioritization excludes currency gain/loss and cash-advance-return expenses, then processes earliest transaction date first and record key second; it excludes mismatched currencies when matching-currency option applies and respects user exclusion. |

## 5.6 Sensitive-data and privacy requirements

| ID | Requirement |
|---|---|
| S-01 | Restrict access to unencrypted credit-card account numbers (130, 154), bank account/routing numbers (16–17), bank tax ID (302), and personal contact information (264–265). |
| S-02 | Include bank account/routing fields only if explicitly requested and approved in the extract scope. |
| S-03 | Encrypt SAE files in transit and apply secure storage, access logging, retention, and masking controls in the receiving environment. |
| S-04 | Avoid exposing sensitive fields in application logs, rejected-record reports, monitoring events, or non-production data sets. |

---

# 6. Implementation Requirements

## 6.1 Parser requirements

1. Parse the file as pipe-delimited text while retaining empty fields and trailing positions.
2. Use positional mapping—not label matching—because SAE is a fixed-column layout.
3. Process one header followed by zero or more details.
4. Separate raw ingestion, technical validation, transformation, and posting/error handling.
5. Retain original batch ID, sequence number, Report ID, Report Key, Report Entry Key, Journal Key, and card references for traceability.
6. Version the mapping explicitly as **SAE V3**. Do not use the V2 mapping for a V3 file.

## 6.2 GL/AP mapping requirements

- Construct the accounting string from the configured report/entry/allocation organisational and custom fields plus journal Account Code (167) as the natural account.
- Use entry-level dimensions for cross-charge scenarios.
- Apply the allocation fallback rule if system allocation dimensions are blank.
- Treat the journal amount as signed and use Debit/Credit as the accounting indicator; do not infer sign solely from account or payment type.
- Ensure custom field meanings are captured in a client-specific mapping catalogue; SAE defines capacity and source columns, but does not define the organisation’s custom-field semantics.

## 6.3 Reconciliation and operational requirements

- Reconcile each batch using header record count and journal total before posting.
- Make processing idempotent using Batch ID plus stable record identifiers; do not repost a previously completed batch without an explicit reversal/reload procedure.
- Quarantine technical failures at record level only if downstream controls can preserve batch integrity; otherwise hold the full batch.
- Publish a control report containing batch identifiers, source/detail count, accepted/rejected count, journal total, posting total, and rejected reasons.
- Align job scheduling with downstream availability and, for Invoice Pay, run SAE daily.
- Test master-data changes using the SAE snapshot behavior described in Section 2.4.

---

# 7. Key Data Rules by Use Case

## 7.1 Employee reimbursement

- Identify the employee using Employee ID (5), with Vendor ID mapping commonly sourced from Report Custom17 (57) where configured.
- Use Report ID (19) as a candidate voucher number.
- Use Amount Due Employee (313) for payment interfaces that cannot accept negative amounts; use Actual Total Due Employee (319) for true signed balances.
- Where Expense Pay is relevant, use reimbursement type (128), funding account codes (254–255), estimated payment date (256), and funding trace (257).

## 7.2 Company-card and statement processing

- Use card transaction identifiers and references for reconciliation.
- For company card obligations, review Billing Amount (153), Amount Due Company Card (314/320), payer/payee types, and payment codes.
- Use company bill statement period fields (251–253) for statement-related processing.

## 7.3 VAT recovery

- Gate VAT processing on Report Has VAT Entry (29) and populated VAT fields.
- Retain tax source (229), tax code (232), reclaim flags/codes (233, 236, 238), and merchant tax ID (352).
- Reconcile entry-level total tax/net tax and reclaim/net reclaim formulas.
- Where allocation applies, use allocation tax totals (347–351) rather than only entry-level totals.

## 7.4 Cash advances

- Enable/consume issuance records only if the implementation intends to account for cash advance issuance outside Concur or through the extract.
- Identify issuance using type `1`, applications using type `2`, and system/balance-due records using type `3`.
- Treat IBCP ATM withdrawals differently: they generate no company liability issuance record in financial extracts.

---

# 8. Extract Scope and Configuration Checklist

Before production deployment, define the following client-specific decisions:

- [ ] Confirm the extract is **Standard Accounting Extract V3**, not V2.
- [ ] Confirm delimiter, encoding, output location, encryption, and secure transfer mechanism.
- [ ] Confirm all 400 positions are preserved by the file-generation and integration platforms.
- [ ] Document each client-defined Org Unit and Custom field’s business meaning, target field, mandatory status, and validation list.
- [ ] Decide whether employee banking and card-account fields are necessary; obtain security approval if enabled.
- [ ] Confirm text case is **As Entered**.
- [ ] Confirm decimal precision and downstream rounding rule.
- [ ] Configure allocation defaults or implement the allocation source-field fallback.
- [ ] Define VAT-recovery/tax reconciliation treatment.
- [ ] Define Company Card, Expense Pay, Cash Advance, Balance Due Management, Travel Allowance, and Travel Request scope.
- [ ] Define daily schedule where Invoice Pay is used.
- [ ] Establish batch-level reconciliation, rejection, replay, and audit procedures.

---

# 9. Notes on Scope and Source Fidelity

- SAE V3 contains numerous client-configurable fields. The source specification provides the field capacities and generic sources but does not define the client’s actual custom field names, mandatory rules, code lists, or GL mapping.
- Columns designated **Future Use** must remain in the positional layout and must not be assigned local meanings.
- This conversion preserves all major field ranges and all source-defined enumerations relevant to SAE parsing and validation. For a build specification, append a client-specific mapping table that documents every selected field, target system field, transformation, default, validation, owner, and error treatment.
