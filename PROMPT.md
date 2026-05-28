# Agent Orchestration Prompt — Short-Term Rental Owner Disbursement Platform

## MISSION
Build a full-stack, production-grade Owner Disbursement Management Platform for a short-term rental property management company. The system manages trust account funds, calculates owner payouts after commissions and expenses, and reconciles channel payments against reservations. The agent must build everything end-to-end autonomously. Credentials will be supplied after scaffolding is complete.

## TECH STACK
- Frontend: React + Tailwind CSS (refined, professional financial dashboard aesthetic — think dark navy/slate with gold accents, clean data tables, clear typographic hierarchy)
- Backend: Node.js / Express REST API
- Database: PostgreSQL
- File Parsing: PDF.js + SheetJS (xlsx) for document ingestion
- Auth: JWT-based authentication
- Deployment-ready: Dockerized with .env credential injection
- Final step: Postmark API integration for email delivery of disbursement reports (credentials provided post-build)

## CORE MODULES TO BUILD

### MODULE 1 — Owner & Property Registry
- CRUD interface for owners and their associated listings
- Each owner record stores:
  - Name, contact, banking/payout details
  - One or more property listings (each with its own platform connections)
  - Custom commission structure per owner per platform (e.g., Owner A: 20% Airbnb, 18% Booking.com; Owner B: flat $150/mo + 15%)
  - Commission type options: percentage of gross, percentage of net, flat fee, tiered
- Each listing stores: platform IDs (Airbnb listing ID, Booking.com property ID, VRBO ID), address, cleaning fee baseline, utility cap if applicable

### MODULE 2 — Channel Payout Logic Engine
Build a rules engine that understands how each platform disburses funds. All payout date calculations must be deterministic given a reservation's dates.

**Airbnb**
- Payout triggers: day after guest check-in
- If that day falls on a Saturday or Sunday → payout moves to the following Monday
- Payment processor identifier: Pionear / Airbnb Payments

**Booking.com**
- Payout triggers: the Friday following guest checkout
- If a reservation spans two calendar months, the payout date (the Friday after checkout) determines which disbursement month it belongs to — even if the majority of stay nights fell in the prior month
- Payment processor identifier: Booking.com (appears directly in bank/trust statements)

**VRBO**
- Payout triggers: based on reservation creation date, not stay dates — payment is released according to VRBO's schedule tied to when the booking was made, and may arrive before the actual stay
- Payment processor identifier: Stripe

The engine must:
- Accept a reservation (platform, check-in date, check-out date, booking date, gross amount)
- Return: expected payout date, disbursement month assignment, net after platform fee
- Store platform fee rates as configurable values (e.g., Airbnb host fee ~3%, Booking.com commission ~15%, VRBO ~5% — these must be editable per listing)

### MODULE 3 — Document Ingestion Pipeline
Build an upload interface and parser pipeline that accepts:

1. **Trust Account Transaction Statement (PDF or CSV)**
   - Parse all transactions for the month
   - Identify and tag each transaction by payment processor: detect "Airbnb", "Pionear", "Booking.com", "Stripe/VRBO" in the description field
   - Map each detected payment to the appropriate channel
   - Flag unmatched transactions for manual review

2. **Property Management Away Report / Reservations Export (CSV or Excel)**
   - Columns expected: listing name/ID, guest name, check-in, check-out, booking date, platform, gross payout, platform fee, net payout
   - System ingests and stores all reservations for the period

3. **Owner Expense Sheet (CSV, Excel, or PDF)**
   - Line items: description, amount, listing, date
   - Categories: maintenance, repairs, supplies, miscellaneous

4. **Cleaning & Utilities Report (CSV, Excel, or PDF)**
   - Per-listing line items: cleaning date/turnover, cleaning cost, utility type (electric, water, gas, etc.), utility amount, billing period

The pipeline must:
- Auto-match trust account payments → reservations → listings → owners
- Flag any payment received in the trust account that cannot be matched to a reservation
- Flag any reservation whose expected payout has not yet appeared in the trust account

### MODULE 4 — Disbursement Calculation Engine
For a given disbursement month and owner, calculate:

```
GROSS CHANNEL PAYOUT (from trust account, matched to reservations in this disbursement month)
− PLATFORM FEES (Airbnb fee, Booking.com commission, VRBO fee — per reservation)
= NET CHANNEL REVENUE

− MANAGEMENT COMMISSION (owner's custom rate applied to net channel revenue)
= OWNER GROSS BEFORE EXPENSES

− OWNER EXPENSES (from expense sheet, filtered to this owner/listing/month)
− CLEANING COSTS (from cleaning report, filtered to this listing/month)
− UTILITIES (from utilities report, filtered to this listing/month)
= FINAL OWNER PAYOUT
```

Rules:
- If a Booking.com reservation straddles two months, assign 100% of the payout to the month in which the Friday-after-checkout falls
- If an Airbnb payout lands on a Monday due to weekend rollover, it belongs to the month that Monday falls in
- VRBO payouts are assigned to the month they physically appear in the trust account
- A disbursement period runs from the 1st to the last day of the calendar month
- All calculations must be stored with a full audit trail: each line item traceable to its source document and reservation

### MODULE 5 — Reconciliation Dashboard
Build a UI dashboard showing for each month:
- Trust Account Summary: total received, broken down by channel
- Reservation Ledger: table of all reservations, their expected payout date, actual payout received (matched/unmatched), disbursement month assigned
- Per-Owner Disbursement Summary:
  - Gross revenue by listing
  - Platform fees deducted
  - Management commission deducted
  - Expenses deducted (itemized)
  - Cleaning + utilities deducted (itemized)
  - Net payout to owner
- Unmatched Payments Queue: payments in the trust account that could not be auto-matched — with a manual match UI
- Pending Payouts: reservations whose payout has not yet arrived in the trust account

### MODULE 6 — Disbursement Report Generation
For each owner, generate a monthly disbursement statement as a clean PDF containing:
- Company header / logo placeholder
- Owner name, property address(es)
- Reservation detail table (dates, platform, gross, fees, net)
- Commission line item
- Expense itemization
- Cleaning & utilities itemization
- Final payout amount (bold, prominent)
- Month/year, statement generation date

### MODULE 7 — Postmark Email Delivery (credentials provided post-build — scaffold now)
- Integrate Postmark API for transactional email
- Each owner receives their disbursement statement PDF as an email attachment
- Email template: professional, branded, plain-language summary with key figures in the body + PDF attached
- Bulk send: trigger all owner emails for a given month from a single "Send Disbursements" button
- Log all sent emails with timestamp, recipient, and statement month
- Scaffold the integration with a POSTMARK_API_KEY environment variable — leave it empty; credentials will be injected after build

## DATA MODEL (Minimum Required Tables)
owners, listings, commission_rules, reservations, trust_transactions, transaction_reservation_matches, owner_expenses, cleaning_records, utility_records, disbursements, disbursement_line_items, email_log

## BUILD INSTRUCTIONS
1. Scaffold the full monorepo (frontend + backend + DB migrations)
2. Build and seed the database schema
3. Build all backend API routes with validation
4. Build all frontend pages and components
5. Build the document ingestion parsers for all file types
6. Build the payout date calculation engine with full unit tests for all three channel rules including edge cases (weekend rollovers, month-straddling stays)
7. Build the disbursement calculation engine with audit trail
8. Build the PDF report generator
9. Scaffold Postmark integration (env var only — do not hardcode or require a live key to run)
10. Dockerize the application with a docker-compose.yml including PostgreSQL
11. Output a CREDENTIALS_NEEDED.md file listing every environment variable required (database, Postmark, etc.) so the owner can fill them in

Do not stop until the application runs end-to-end locally without credentials. All features except live email sending must be fully functional before credential injection.

## FINAL DELIVERABLE CHECKLIST
- App runs via docker-compose up
- Owner/listing/commission setup UI works
- All three file upload parsers work (trust statement, reservations, expenses, cleaning/utilities)
- Channel payout logic engine passes unit tests for Airbnb, Booking.com, VRBO edge cases
- Disbursement calculation engine produces correct owner payout with full audit trail
- Reconciliation dashboard shows matched/unmatched payments
- PDF disbursement statements generate correctly per owner
- Postmark integration scaffolded and ready for key injection
- CREDENTIALS_NEEDED.md output with all required env vars
