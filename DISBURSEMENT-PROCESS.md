# LiveLuxe Trust Owner Disbursement Process

## Overview

LiveLuxe manages 80+ short-term rental properties across Melbourne for 30+ owners. Each month, owner disbursements are calculated based on booking income received into the trust account, minus channel fees, cleaning, management commission (with GST), software fees, and property expenses.

---

## Monthly Disbursement Timeline

| Step | Action | Who | When |
|------|--------|-----|------|
| 1 | Sync Hostaway reservations | System/Admin | 1st of month |
| 2 | Upload trust account bank statement | Admin | After last bank transaction settles |
| 3 | Run auto-match (reservations ↔ bank entries) | System | After upload |
| 4 | Manually match any unmatched transactions | Admin | As needed |
| 5 | Calculate disbursements per owner | System | After matching complete |
| 6 | Review disbursement summaries | Admin | Before payment |
| 7 | Generate ABA file for NavConnect | System | Payment day |
| 8 | Upload ABA to bank for batch payment | Admin | Payment day |
| 9 | Send PDF statements to owners via email | System | After payment |

---

## Step-by-Step Process

### Step 1: Sync Hostaway Reservations

**What it does:** Pulls all reservations from Hostaway (Account 71167) for all mapped listings, including check-in/out dates, guest names, gross booking amounts, cleaning fees, and platform source.

**How:** Click **"Sync Hostaway"** on the dashboard, or the system calls:
```
POST /api/hostaway/sync
```

**Data captured per reservation:**
- Hostaway reservation ID
- Listing (mapped to owner)
- Guest name
- Check-in / Check-out dates
- Gross booking amount (total guest payment)
- Cleaning fee
- Platform (Airbnb, Booking.com, VRBO, Direct)
- Channel payout amount (gross minus channel commission)

---

### Step 2: Upload Trust Account Bank Statement

**What it does:** Imports the monthly bank statement CSV from your trust account so the system can verify which payouts have actually been received.

**How:** Use the **"Trust Statement"** uploader on the dashboard. Upload a CSV exported from your bank (NAB or other).

**Expected CSV format:**
| Date | Description | Amount |
|------|-------------|--------|
| 01/05/2026 | AIRBNB PAYMENTS - JANE SMITH | 1,245.50 |
| 03/05/2026 | BOOKING.COM BV - JOHN DOE | 890.00 |

The system parses the CSV and creates trust transaction records with status `unmatched`.

---

### Step 3: Auto-Match Reservations to Bank Entries

**What it does:** Automatically matches bank statement entries to Hostaway reservations using amount matching, date proximity, and guest name similarity.

**How:** Click **"Auto-Match"** on the dashboard, or:
```
POST /api/reconcile/auto-match
```

**Matching logic:**
1. For each unmatched trust transaction, find reservations with matching or close amounts
2. Score candidates by: amount match (exact or within tolerance), date proximity to expected payout date, guest name similarity
3. High-confidence matches (score > threshold) are auto-linked
4. Matched reservations are flagged as `payout_received = true` with the bank transaction date

**After auto-match, the dashboard shows:**
- Total matched count
- Unmatched bank entries (for manual review)
- Match confidence scores

---

### Step 4: Manual Match (If Needed)

**What it does:** Lets you manually link unmatched bank entries to reservations. Common reasons for unmatched entries:
- Partial payouts (platform held back some amount)
- Combined payouts (multiple bookings in one bank entry)
- Name mismatches between Hostaway and bank narrative

**How:** In the "Unmatched Payments" section, click **"Match"** next to an unmatched transaction. The system shows ranked candidates. Select the correct reservation.

---

### Step 5: Calculate Disbursements

**What it does:** Calculates the exact payout for each owner for the selected month, applying all fees, commissions, and deductions in the correct order.

**How:** Select the month and click **"Calculate"** next to an owner, or calculate all:
```
POST /api/disbursements/{month}/{ownerId}/calculate
```

#### Disbursement Eligibility — BOTH Conditions Required:

| Condition | Rule |
|-----------|------|
| **Booking elapsed** | Checkout date is on or before the last day of the disbursement month |
| **Payout received** | Bank statement shows the payout landed in the trust account during that month |

> **Example:** A guest checks out May 28. Airbnb pays 1 business day after check-in, so payout lands May 15. Both conditions met for May disbursement. But if checkout is June 2, the booking is NOT eligible for May even if the payout arrived in May.

---

### Step 6: The Calculation — Detailed Breakdown

This is the core business logic. Every dollar is accounted for in this exact order:

```
GROSS BOOKING (what the guest paid)
  − Channel Commission
  ─────────────────────────────────
  = CHANNEL PAYOUT (what enters trust)
  − Cleaning Fee
  ─────────────────────────────────
  = NET INCOME
  − Management Fee (18% of net income)
  − GST on Management Fee (10% of management fee = 1.8% of net income)
  ─────────────────────────────────
  = AFTER MANAGEMENT
  − Software Fee ($65.99/month per active property)
  − One-off Expenses (OC levies, strata, water, internet, electricity)
  ─────────────────────────────────
  = FINAL OWNER PAYOUT
```

#### Channel Commission Rates:

| Platform | Commission Rate | Notes |
|----------|----------------|-------|
| Airbnb | 16.5% | Deducted before payout to trust |
| Booking.com | 16.5% | Deducted before payout to trust |
| VRBO | 12.0% | Deducted before payout to trust |
| Direct | 0% | Full amount enters trust |

#### Worked Example:

```
Guest pays:                    $1,000.00 (Gross booking - Airbnb)
Channel commission (16.5%):   −  $165.00
                               ─────────
Channel payout (into trust):    $835.00
Cleaning fee:                 −  $120.00
                               ─────────
Net income:                     $715.00
Management fee (18%):         −  $128.70
GST on mgmt fee (10%):       −   $12.87
                               ─────────
After management:               $573.43
Software fee:                 −   $65.99
Expenses this month:          −    $0.00
                               ─────────
FINAL OWNER PAYOUT:             $507.44
```

#### Key Rules:
- **Cleaning is deducted BEFORE management fee** (reduces the base for commission)
- **Management fee is 18% + GST (10%)** — effectively 19.8% of net income
- **Software fee is per property, not per booking** — $65.99/month for each listing that had at least one booking
- **Expenses are deducted last** — one-off costs like OC levies, strata, utilities

---

### Step 7: Expected Payout Timing by Platform

The system calculates expected payout dates to help with reconciliation:

| Platform | Payout Timing | Weekend Rule |
|----------|--------------|--------------|
| Airbnb | 1 business day after **check-in** | Saturday/Sunday → Monday |
| Booking.com | First Friday after **checkout** | Always lands on Friday |
| VRBO | Based on booking confirmation date | Standard business days |
| Direct | Immediate (manual entry) | N/A |

> **Month-boundary edge case:** If a guest checks in on a Friday (e.g., May 30), the payout is due the next business day — Monday June 2. This payout belongs to the **June** disbursement period, not May, because it lands in the trust account in June.

---

### Step 8: Generate ABA File for Bank Payment

**What it does:** Creates an ABA (Australian Banking Association) file — a fixed-width text file used by Australian banks for batch payments via NavConnect or similar systems.

**How:** Click **"Download ABA"** for the month, or:
```
GET /api/aba/{month}
```

**ABA file structure:**
- **Header (Type 0):** Your trust account BSB, account name, bank code, date
- **Detail records (Type 1):** One line per owner — their BSB, account number, amount, name
- **Footer (Type 7):** Total amount, record count, hash total

**Before first use:** Configure your trust account details (BSB, account number, bank name) in the Trust Account Config section under Setup.

**To pay owners:**
1. Download the `.aba` file
2. Log into your bank's business portal (NAB NavConnect)
3. Upload the ABA file as a batch payment
4. Authorise the payment

---

### Step 9: Send Owner Statements

**What it does:** Generates a branded PDF statement for each owner and emails it via Postmark.

**PDF includes:**
- LiveLuxe branding and disbursement period
- Per-property booking table (dates, guest, platform, gross, channel fee, payout)
- Cleaning fees breakdown
- Net income calculation
- Management fee with GST line items
- Software fee
- Expenses
- **Bold final payout amount in AUD**

---

## Data Flow Diagram

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Hostaway    │────>│  Reservations │────>│                 │
│  (bookings)  │     │  + cleaning   │     │                 │
└─────────────┘     │  + platform   │     │   DISBURSEMENT  │
                     └──────────────┘     │   ENGINE        │
┌─────────────┐     ┌──────────────┐     │                 │
│  Bank CSV    │────>│  Trust        │────>│  Matches both:  │
│  (statement) │     │  Transactions │     │  • Elapsed      │
└─────────────┘     └──────────────┘     │  • Received     │
                                          │                 │
┌─────────────┐     ┌──────────────┐     │                 │
│  Manual      │────>│  Expenses     │────>│                 │
│  Entry       │     │  (one-off)    │     └────────┬────────┘
└─────────────┘     └──────────────┘              │
                                                   ▼
                                          ┌─────────────────┐
                                          │  Per-Owner       │
                                          │  Disbursement    │
                                          │  Summary         │
                                          └────────┬────────┘
                                                   │
                                    ┌──────────────┼──────────────┐
                                    ▼              ▼              ▼
                              ┌──────────┐  ┌──────────┐  ┌──────────┐
                              │ PDF      │  │ ABA File │  │ Email    │
                              │ Statement│  │ (bank)   │  │ to Owner │
                              └──────────┘  └──────────┘  └──────────┘
```

---

## Commission Rules

Each owner has a commission rule stored in the database:

| Field | Default | Description |
|-------|---------|-------------|
| Type | `au_management` | Australian management fee with GST |
| Rate | `0.18` (18%) | Base management rate |
| Platform | `all` | Applies to all platforms (can be per-platform) |
| GST | Auto (10%) | Calculated as 10% of the management fee |

Commission rules can be customised per owner or per listing in the **Setup** tab.

---

## Trust Account Configuration

Before generating ABA files, configure your trust account:

| Field | Example | Description |
|-------|---------|-------------|
| BSB | `083-004` | Trust account BSB |
| Account Number | `12-345-6789` | Trust account number |
| Account Name | `LiveLuxe Property Trust` | Name on account |
| Bank Name | `NAB` | Financial institution |
| FI Code | `NAB` | 3-letter bank code for ABA |
| APCA User ID | `000000` | Assigned by your bank |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No bookings after Hostaway sync | Check listing has `hostaway_listing_id` mapped in Setup |
| Bank entry won't auto-match | Amount or name too different — use manual match |
| Owner shows $0 disbursement | Check both conditions: booking elapsed AND payout in trust |
| Payout in wrong month | Check payout timing rules — weekend rollovers can push to next month |
| ABA file rejected by bank | Verify trust account BSB/account in Trust Config |
| Cleaning fee is $0 | Hostaway may not have cleaning fee set — check listing in Hostaway |

---

## Platform URLs

| Service | URL |
|---------|-----|
| **Live App** | https://owner-disbursement-platform.vercel.app |
| **GitHub (Primary)** | https://github.com/littletwolittletwo-ux/owner-disbursement-platform |
| **GitHub (Reference)** | https://github.com/littletwolittletwo-ux/owner-disbursement-platform-reference |
| **Neon Database** | ep-fragrant-union-aqfo6egi-pooler.c-8.us-east-1.aws.neon.tech |
| **Hostaway** | Account 71167 |

---

*LiveLuxe Property Management — Owner Disbursement Platform v1.0*
*Built June 2026*
