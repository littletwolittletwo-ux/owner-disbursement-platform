# LiveLuxe Property Management
# Trust Owner Disbursement — Operations Manual

---

## 1. Overview

LiveLuxe manages 80+ short-term rental properties across Melbourne for 30+ owners. Each month, disbursements are processed to pay owners their share of booking income after all fees, commissions, and expenses are deducted.

Previously, this was done manually by an external accountant (Craig) who reconciled multiple data sources. This platform automates the entire process.

---

## 2. What Craig Used To Do (Manual Process)

Craig had access to:
- **Hostaway** (his own API) — for reservation data, booking details, guest info
- **Stripe secret key** — for Hostaway direct bookings and VRBO payments
- **Airbnb payout reports** — showing when Airbnb paid out, not reservation data, purely paid information. Payout reports for both accounts, first to last of the previous month
- **Booking.com payout reports** — same format, first to last of month
- **Trust account bank statements** — from first to last of the month

Craig would manually reconcile these three data sources:
1. The booking exists in Hostaway
2. You've been paid out for that same reservation ID on the platform payout reports
3. The money has entered the trust bank account

This three-way match is what the platform now automates.

---

## 3. Data Sources & Inputs

### 3.1 Hostaway Sync (Automatic)
- Pulls all reservations from Hostaway (Account 71167, 87 listings)
- Captures: reservation ID, listing, guest name, check-in/out dates, gross amount, cleaning fee, platform
- **Click "Sync Hostaway"** on the dashboard or it runs automatically

### 3.2 Platform Payout Reports (Upload)
Every dollar amount paid out is linked to a reservation ID on Airbnb and Booking.com. These reports confirm what the platform actually paid you.

- **Airbnb payout report** — export from Airbnb for the full previous month (1st to last)
- **Booking.com payout report** — export from Booking.com for the full previous month
- Upload via the **"Trust Statement"** uploader (the system treats these as trust transactions since they represent money entering trust)

### 3.3 Trust Account Bank Statement (Upload)
- Export CSV from your bank (NAB) for the month, 1st to last
- This is the definitive record of money entering the trust account
- Upload via **"Trust Statement"** uploader
- Format: Date | Description/Narrative | Amount

### 3.4 Expenses (Upload or Manual Entry)
- One-off expenses paid on behalf of owners
- Found in the Slack channel "owners" and emails to accounts@liveluxeau.com
- Upload via **"Expenses"** uploader or enter manually
- These include: OC fees, strata fees, water, internet, electricity, pictures, repairs

---

## 4. The Three-Way Reconciliation

A booking is only considered "confirmed for payout" when ALL THREE match:

| Check | Source | What It Proves |
|-------|--------|----------------|
| 1. Booking exists | Hostaway | The reservation is real and has details |
| 2. Platform paid out | Airbnb/Booking.com payout report | The platform sent the money |
| 3. Money entered trust | Bank statement | The money actually arrived |

### How the platform does this:
1. **Auto-Match** — After uploading bank statements, click "Auto-Match". The system matches bank entries to Hostaway reservations by amount, date proximity, and guest name similarity
2. **Manual Match** — Any unmatched bank entries appear in the "Unmatched Payments" section. Click "Match" to manually link them to the correct reservation
3. Once matched, the reservation is flagged as `payout_received = true`

---

## 5. Disbursement Conditions — BOTH Required

**An owner only gets paid for a booking when BOTH conditions are true:**

| Condition | Rule |
|-----------|------|
| **Booking has elapsed** | The guest has checked out on or before the last day of that month |
| **Payout received in trust** | The money from that booking has entered the trust bank account during that month |

### Why both matter:
- If the booking finishes in May but the money doesn't arrive until June → **NOT in May disbursement** (payout not received)
- If the money arrives in May but the guest doesn't check out until June → **NOT in May disbursement** (booking hasn't elapsed)
- If both happen in May → **YES, included in May disbursement**

---

## 6. Payout Timing by Platform

Each platform has different payout schedules. This is critical for understanding which month a payout falls into.

### 6.1 Airbnb
- **Pays 1 business day after CHECK-IN** (not checkout)
- Business days = Monday to Friday
- If check-in is Friday → next business day is Monday
- If check-in is Saturday → next business day is Monday
- If check-in is Sunday → next business day is Monday

### 6.2 Booking.com
- **Pays the following Friday after CHECKOUT**
- If checkout is Monday → payout Friday of that week
- If checkout is Friday → payout the following Friday (7 days later)
- If checkout is Thursday → payout the next day (Friday)

### 6.3 VRBO
- Based on booking confirmation date
- Standard business day processing

### 6.4 Direct Bookings (via Stripe/Hostaway)
- Payment collected at time of booking via Stripe
- Immediately available in trust

---

## 7. The End-of-Month Edge Case

This is the most important edge case to understand.

**Example scenario:** February 28 is a Sunday, February 27 is Saturday, February 26 is Friday.

A one-night Airbnb reservation:
- Check-in: February 25 (Thursday)
- Check-out: February 26 (Friday)
- Airbnb pays: 1 business day after check-in = Friday February 26
- Result: **Booking elapsed in February, payout received in February** → Included in February disbursement

But change it slightly:
- Check-in: February 26 (Friday)
- Check-out: February 27 (Saturday)
- Airbnb pays: 1 business day after check-in = Monday March 1 (next business day after Friday is Monday)
- Result: **Booking elapsed in February, but payout NOT received until March** → NOT in February disbursement, rolls to March

This is why end-of-month weekends can push payouts to the next month even when the booking starts and finishes within the current month.

---

## 8. The Calculation — Exact Order

This is the precise order of deductions. Getting this wrong changes every number downstream.

```
STEP 1: GROSS BOOKING AMOUNT
         (What the guest paid in total)

STEP 2: − Channel Commission
         Airbnb:      16.5% of gross
         Booking.com: 16.5% of gross
         VRBO:        12.0% of gross
         Direct:       0.0%
         ──────────────────────────────
       = CHANNEL PAYOUT
         (What actually enters your trust account)

STEP 3: − Management Fee (18% of channel payout)
       − GST on Management Fee (10% of management fee)
         (Commission is 18% + GST. On the report it shows as
          "Management Fee" and "GST on Management Fee" separately.
          Effectively 19.8% of channel payout.)
         ──────────────────────────────
       = AFTER MANAGEMENT

STEP 4: − Cleaning Fee
         (The cleaning fee charged to the guest is deducted here.
          The owner pays the cleaner — this is their cost.
          Deducted AFTER management so LiveLuxe earns commission
          on the full channel payout, not reduced by cleaning.)
         ──────────────────────────────
       = AFTER CLEANING

STEP 5: − Software Fee ($65.99 per property per month)
         (Covers KeyNest + PriceLabs + Enso. We take a small loss
          on some properties. Charged as a flat monthly fee.)
         ──────────────────────────────
       = AFTER SOFTWARE

STEP 6: − One-Off Expenses
         (OC fees, strata, water, internet, electricity, repairs,
          photography — anything paid on behalf of the owner.
          Found in Slack "owners" channel and accounts@ emails.
          These are POST management fee — you should not make
          less commission because an owner has high expenses.
          Expenses are the owner's running costs, completely separate.)
         ──────────────────────────────
       = FINAL OWNER PAYOUT
```

### Why This Order Matters

**Management fee is calculated BEFORE cleaning:**
- LiveLuxe's management commission is 18% of the channel payout (what enters trust).
- Cleaning is an owner cost deducted after, so it does not reduce LiveLuxe's commission base.

**Expenses are deducted AFTER management fee:**
- You (LiveLuxe) are choosing to help owners pay their bills.
- You should not be punished (earn less commission) because an owner has high expenses.
- If the expense is really high, you shouldn't make less.
- Expenses are running costs to the owner, completely separate from your commission base.
- Same principle applies to pictures, repairs, and any one-off costs.

---

## 9. Worked Example

**Booking:** Airbnb, guest pays $1,000, cleaning fee $120

```
Gross booking:                     $1,000.00
Channel commission (16.5%):       −   $165.00
                                   ──────────
Channel payout (enters trust):       $835.00

Management fee (18% of $835):    −   $150.30
GST on management fee (10%):     −    $15.03
                                   ──────────
After management:                    $669.67

Cleaning fee:                     −   $120.00
                                   ──────────
After cleaning:                      $549.67

Software fee:                     −    $65.99
                                   ──────────
After software:                      $483.68

Expenses (e.g. water bill):       −    $85.00
                                   ──────────
FINAL OWNER PAYOUT:                  $398.68
```

---

## 10. The Owner Disbursement Report (PDF)

The PDF sent to each owner contains:

### Header
- LiveLuxe branding
- Disbursement period (e.g. "May 2026")
- Owner name

### Section 1: Booking Income
Per-property table with columns:
| Dates | Guest | Platform | Gross | Channel Fee | Payout |
|-------|-------|----------|-------|-------------|--------|

Shows every booking that elapsed in that month AND whose payout was received.

### Section 2: Management Fee
- Base: 18% of channel payout
- GST: 10% of management fee (1.8% of channel payout)
- Total management deduction

### Section 3: Cleaning Fees
Total cleaning fees deducted across all bookings.

### Section 5: Monthly Charges
- Software fee: $65.99 per active property

### Section 6: Expenses
Itemised list of one-off expenses paid on behalf of the owner:
- OC fees, strata, water, internet, electricity, repairs, etc.

### Section 7: Final Payout
**Bold total in AUD — the amount being paid to the owner.**

---

## 11. ABA Export & Payment

Once all disbursements are calculated and reviewed:

1. **Generate ABA file** — Click "Download ABA" for the month
2. **Upload to NavConnect** — Log into NAB's business banking, upload the .aba file as a batch payment
3. **Authorise** — The ABA export only works on the day you generate the report. Once actioned, payments are sent to all owners at once
4. **Send emails** — Disbursement PDF emails are sent to each owner outlining their booking breakdowns, net income, reservation dates, and all deductions

### ABA File Format
- Australian Banking Association fixed-width text file
- Header: Trust account BSB, account name, bank code, date
- One line per owner: their BSB, account number, payout amount, name
- Footer: totals and record count

### Trust Account Config
Before first use, set up your trust account details in the Setup tab:
- BSB, Account Number, Account Name
- Bank Name (NAB)
- Financial Institution Code
- APCA User ID (assigned by your bank)

---

## 12. Monthly Process Checklist

| # | Step | Action | Where |
|---|------|--------|-------|
| 1 | Sync bookings | Click "Sync Hostaway" | Dashboard |
| 2 | Upload Airbnb payout report | Upload CSV for 1st–last of month | Trust Statement uploader |
| 3 | Upload Booking.com payout report | Upload CSV for 1st–last of month | Trust Statement uploader |
| 4 | Upload bank statement | Export trust account CSV, upload | Trust Statement uploader |
| 5 | Run auto-match | Click "Auto-Match" | Dashboard |
| 6 | Review unmatched | Manually match remaining entries | Unmatched Payments section |
| 7 | Upload expenses | Upload or enter one-off owner expenses | Expenses uploader |
| 8 | Calculate disbursements | Select month, calculate for all owners | Disbursement section |
| 9 | Review summaries | Check each owner's breakdown is correct | Expandable rows |
| 10 | Download ABA | Click "Download ABA" for the month | Dashboard |
| 11 | Upload to NavConnect | Upload .aba to NAB business banking | NAB portal |
| 12 | Authorise payment | Approve batch payment in NAB | NAB portal |
| 13 | Send owner emails | Click "Send Emails" | Dashboard |

---

## 13. Commission Structure

| Item | Rate | Applied To |
|------|------|-----------|
| Management fee | 18% | Channel payout (after channel fee, before cleaning) |
| GST on management | 10% of management fee | Management fee amount |
| Effective total | 19.8% | Channel payout |

Commission rules are per-owner and can be customised in the Setup tab. Default is 18% `au_management` type for all owners.

---

## 14. Channel Commission Rates

| Platform | Commission | Who Deducts It |
|----------|-----------|----------------|
| Airbnb | 16.5% | Airbnb (before payout) |
| Booking.com | 16.5% | Booking.com (before payout) |
| VRBO | 12.0% | VRBO (before payout) |
| Direct | 0% | N/A |

These are deducted by the platform before the money reaches your trust account. The gross amount is what the guest paid; the channel payout is what you actually receive.

---

## 15. Recurring vs One-Off Costs

### Recurring (Monthly)
| Fee | Amount | Per |
|-----|--------|-----|
| Software fee | $65.99 | Per property per month |

Covers: KeyNest + PriceLabs + Enso. LiveLuxe absorbs the difference on some properties.

### One-Off (As Incurred)
| Type | Examples |
|------|----------|
| OC fees | Owners corporation levies |
| Strata fees | Body corporate charges |
| Water | Water bills |
| Internet | Internet service |
| Electricity | Power bills |
| Repairs | Maintenance, fixes |
| Photography | Property photos |
| Other | Anything paid on owner's behalf |

Source: Slack "owners" channel + emails to accounts@liveluxeau.com

**Key rule:** All one-off expenses are deducted AFTER management fee. LiveLuxe should not earn less commission because an owner has high running costs.

---

## 16. Platform URLs

| Service | URL |
|---------|-----|
| **Live Platform** | https://owner-disbursement-platform.vercel.app |
| **Login** | admin@example.com / admin123 |
| **GitHub (Primary)** | https://github.com/littletwolittletwo-ux/owner-disbursement-platform |
| **GitHub (Reference)** | https://github.com/littletwolittletwo-ux/owner-disbursement-platform-reference |

---

## 17. Current Data Status (as of June 2026)

- **24 owners** seeded with contact details
- **30 listings** mapped to Hostaway listing IDs
- **87 Hostaway listings** detected (many managed properties not yet assigned to owners)
- **3,251 reservations** synced (last 2 months)
- **186 May bookings** mapped to owners across 28 properties
- **~$139,000** gross May booking value
- Commission rules set: 18% `au_management` for all owners

---

*LiveLuxe Property Management — Disbursement Operations Manual v1.0*
*June 2026*
