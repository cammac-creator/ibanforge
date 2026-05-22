# Verification of Payee (VoP): what it is, what changes, and how to prepare

> **DRAFT — pending review.** Factual draft prepared 2026-05-22 for the
> distribution-channels plan (VoP / SEPA positioning, audit action #3).
> Before publishing: re-check the regulatory dates against the primary
> sources, adjust the tone, and decide the language (drafted in English to
> match `docs/marketing/`). Not published anywhere yet.

---

If your product moves money across SEPA — a neobank, a payment platform, a
treasury tool, a marketplace paying out sellers — Verification of Payee is
already on your roadmap, whether you put it there or not. Here is a plain
explanation of what it is, what the regulation requires, and what it means
for the systems you build.

## What is Verification of Payee?

Verification of Payee (VoP) is a check that happens *before* a credit
transfer is confirmed. When a payer enters a beneficiary's name and IBAN,
the payer's payment service provider (PSP) asks the beneficiary's PSP
whether that name actually matches that account. The payer gets one of a
few answers — typically a match, a close match (with the real name
suggested), or no match — and then decides whether to go ahead.

It is a small change in the user experience and a large change in the
plumbing. The payment itself is unaffected; what is new is a real-time
name-checking exchange between two PSPs that has to happen in the seconds
before the payer clicks "send".

## Why does it exist?

Two problems. The first is plain error: an IBAN typed or pasted wrong sends
money to a stranger, and recalling a SEPA transfer is slow and uncertain.
The second, and the real driver, is **authorised push payment fraud** —
scams where the victim is manipulated into sending money themselves, to an
account they believe is legitimate. Because the victim authorises the
payment, traditional fraud controls do not catch it. Checking the
beneficiary name against the IBAN at the moment of payment is one of the
few interventions that works against this pattern.

## What does the regulation require, and when?

VoP is mandated by the EU Instant Payments Regulation (Regulation (EU)
2024/886), which amends the SEPA framework. The obligation does not arrive
all at once:

- **Euro-area PSPs** have had to offer VoP since **October 2025**.
- **PSPs in EEA member states outside the euro area** follow from
  **July 2027**.

VoP applies to SEPA credit transfers, instant and non-instant. The European
Payments Council operates the scheme that PSPs adhere to, including the
directory and routing layer PSPs use to reach each other.

*(Draft note: confirm the exact phased dates and any rulebook version
milestones against the EPC and EUR-Lex before publishing.)*

## What do PSPs actually have to do?

In practice, getting VoP-ready means:

1. **Connecting to a verification mechanism.** A PSP either builds direct
   connections to other PSPs or — more commonly for smaller players — routes
   through a Routing and Verification Mechanism (RVM), an intermediary that
   handles the name-matching exchange.
2. **Handling the responses well.** Match, close match, no match — each needs
   a clear, fast UX. A close match has to surface the suggested name without
   leaking more than it should; a no-match has to warn without blocking
   legitimate payments outright.
3. **Getting the upstream data right.** Name matching is only as good as the
   inputs. A malformed IBAN, an account at an electronic money institution
   that issues virtual IBANs, or a beneficiary PSP that is not reachable for
   the relevant SEPA scheme all complicate the check. Cleaning and enriching
   payee data *before* it reaches the VoP step removes a lot of avoidable
   friction.

## Where does IBAN validation fit in?

VoP is a name-matching obligation; it is not an IBAN-validation product, and
IBANforge is not a VoP solution or an RVM. But the two meet at the data
layer, and that is worth being precise about.

Before a VoP request is even worth sending, the IBAN has to be structurally
sound and routable. IBANforge covers that upstream slice: it validates the
IBAN (structure and mod-97 checksum), resolves the BIC, flags whether the
account is issued by a traditional bank or by an EMI / digital issuer (which
is where virtual IBANs and trickier name-matching tend to appear), and
indicates SEPA and VoP reachability for the beneficiary side. It is the
pre-flight check, not the verification itself.

For a team building toward VoP, that means IBANforge is useful in two
places: cleaning a customer or payout database so bad IBANs are caught
before they ever reach the verification flow, and giving the payment UI
enough context — issuer type, reachability — to handle edge cases sensibly.
It does not replace an RVM or a VoP scheme connection.

## Getting ready

The phased timeline gives non-euro-area PSPs room, but the data work does
not wait for a deadline: clean IBAN data, correct BIC resolution and a
clear view of issuer type and reachability are useful the day before VoP
goes live and the day after. That groundwork is also the cheapest part of
the project to start now.

---

*IBANforge is an IBAN validation, BIC/SWIFT lookup and compliance API for
developers and AI agents. Free tier and docs: https://ibanforge.com*
