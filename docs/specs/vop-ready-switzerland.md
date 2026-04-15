# VoP-Ready for Switzerland -- Strategy Document

**Date**: April 2026
**Status**: Draft -- Strategy & Research
**Author**: IBANforge team

---

## Table of Contents

1. [Context: What is VoP?](#1-context-what-is-vop)
2. [Regulatory Timeline](#2-regulatory-timeline)
3. [Switzerland's Unique Position](#3-switzerlands-unique-position)
4. [Target Audience](#4-target-audience)
5. [Value Proposition](#5-value-proposition)
6. [Required Features to Build](#6-required-features-to-build)
7. [Landing Page Structure (FR + DE)](#7-landing-page-structure-fr--de)
8. [Outreach Strategy](#8-outreach-strategy)
9. [Timeline & Roadmap](#9-timeline--roadmap)
10. [Competitive Landscape](#10-competitive-landscape)

---

## 1. Context: What is VoP?

### Definition

Verification of Payee (VoP) is a pre-transaction name-matching service that verifies whether the payee name entered by a payer matches the actual account holder name associated with an IBAN at the receiving PSP (Payment Service Provider). It acts as a real-time "are you sure?" check before a credit transfer is executed.

### Problem Solved

- **APP Fraud (Authorized Push Payment)**: Fraudsters trick victims into transferring money to accounts they control. APP fraud now accounts for over half of all fraudulent credit transfer value in Europe. Global losses estimated at $442 billion in 2025 (Global Anti-Scam Alliance).
- **Misdirected Payments**: Typos in IBANs or payee names cause payments to reach the wrong recipient. Without VoP, the payer has no way to verify before sending.
- **Social Engineering**: Scammers impersonate legitimate businesses with plausible-sounding names. VoP exposes the mismatch between the claimed payee and the actual account holder.

### How VoP Works (EPC Scheme)

1. Payer enters IBAN + payee name in their banking app
2. Payer's PSP sends a VoP request to the payee's PSP via inter-PSP API
3. Payee's PSP checks the name against the account holder record
4. Response is returned within 1 second (5 seconds max per rulebook)
5. Result: **Match**, **Close match** (with suggestion), **No match**, or **Not found**

Three use cases defined by the EPC VoP Scheme Rulebook:
- Name / IBAN check
- Identification code (LEI, VAT) / IBAN check
- Name + additional attribute / IBAN check

---

## 2. Regulatory Timeline

### EU Instant Payments Regulation (IPR)

| Date | Milestone |
|------|-----------|
| **9 Oct 2025** | VoP mandatory for all Eurozone PSPs (banks, EMIs, PIs). EPC VoP Scheme Rulebook v1.0 in force since 5 Oct 2025. |
| **20 Sep 2026** | VoP Scheme Rulebook v1.1 effective |
| **Nov 2026** | VoP Scheme Rulebook v2.0 publication expected |
| **9 Jan 2027** | Non-eurozone SEPA PSPs must be able to **receive** instant credit transfers in EUR |
| **9 Jul 2027** | Non-eurozone SEPA PSPs must be able to **send** instant credit transfers + VoP mandatory |

### PSD3/PSR

Payee name-to-IBAN matching is being codified into primary legislation under PSD3/PSR, extending VoP beyond the existing IPR scope. This solidifies VoP as a permanent fixture of European payments infrastructure, not a temporary overlay.

### Key Implication

VoP is not optional. It is becoming a baseline expectation across all of SEPA, embedded in regulation and in payment scheme rules. Every PSP that touches SEPA credit transfers will need to support it.

---

## 3. Switzerland's Unique Position

### SEPA Member, Not EU Member

Switzerland has been a SEPA participant since 2022. Swiss banks can process euro-denominated SEPA payments. However, Switzerland is **not bound by EU regulation** -- adoption depends on local law and FINMA guidance.

### The euroSIC Discontinuation (Critical)

SIX announced in March 2025 the discontinuation of euroSIC (the Swiss euro clearing system) effective **31 December 2027**:

- **1 Jan 2026**: No new invoice issuers or FIs can be activated on euroSIC
- **31 Aug 2027**: Last date to submit EUR mandates via euroSIC
- **31 Dec 2027**: euroSIC shuts down permanently

This forces every Swiss bank to choose a new path for EUR payments:
1. **Direct SEPA participation** (via EBA CLEARING or other CSMs)
2. **Correspondent banking** (through an EU-based partner bank)
3. **Specialist access provider** (third-party integration)

Each path requires VoP compliance when processing SEPA credit transfers.

### SIC Instant Payments (CHF)

- SIX launched SIC5 instant payments (CHF) end of 2023
- ~60 largest banks completed Phase 1 (August 2024, covering ~95% of Swiss customer payments)
- Remaining banks must onboard by **October 2026**
- Aligned with European SEPA Instant Credit Transfer standard (ISO 20022)

### FINMA's Evolving Stance

- FINMA mandates APP fraud prevention measures for CHF and cross-border transactions
- FINMA Circular 2023/1 makes boards explicitly accountable for operational resilience
- VoP alignment is increasingly seen as a best-practice fraud prevention measure, even for CHF transactions where no EU regulation applies
- Privacy and banking secrecy considerations create additional complexity for Swiss VoP implementations

### Bottom Line for Swiss Institutions

Even without a direct EU mandate, Swiss PSPs face a **de facto VoP obligation** because:
1. euroSIC is shutting down -- they must join SEPA infrastructure directly
2. SEPA participation means complying with EPC scheme rules including VoP
3. FINMA is pushing APP fraud prevention
4. Correspondent banks and EU counterparties will expect VoP readiness

---

## 4. Target Audience

### Tier 1: Cantonal Banks (24 institutions)

The 24 cantonal banks are the backbone of Swiss retail banking. They are state-backed, conservative, and typically slower to adopt new technology. The euroSIC shutdown forces them into action.

**Named targets:**
- **Zurcher Kantonalbank (ZKB)** -- Largest cantonal bank, CHF 200B+ assets
- **Banque Cantonale Vaudoise (BCV)** -- Largest in Romandie
- **Banque Cantonale de Geneve (BCGE)** -- Key Romandie player
- **Basler Kantonalbank (BKB)** -- German-speaking, mid-tier
- **Luzerner Kantonalbank (LUKB)** -- Central Switzerland
- **St.Galler Kantonalbank (SGKB)** -- Eastern Switzerland
- **Berner Kantonalbank (BEKB)** -- Bilingual canton (DE/FR)

**Pain points:** Legacy systems, limited API expertise in-house, regulatory pressure to modernize before 2027, board accountability under FINMA 2023/1.

### Tier 2: National & Universal Banks

- **PostFinance** -- 2.5M+ customers, state-owned (Swiss Post subsidiary), FINMA-supervised. Major payment processor for Swiss businesses.
- **Raiffeisen Group** -- ~220 cooperative banks, 3.5M+ customers. Decentralized structure makes technology rollouts complex.
- **UBS** -- Already implementing VoP (reported 62% APP fraud reduction). May need API-level validation for onboarding flows.

### Tier 3: Swiss Neobanks & Fintechs

- **Neon** -- Mobile-first, accounts via Hypothekarbank Lenzburg. Growing rapidly.
- **Yuh** -- Joint venture Swissquote + PostFinance. Banking + investing.
- **Yapeal** -- FINMA fintech license, now B2B focused. Natural API consumer.
- **Alpian** -- Swiss private banking neobank.
- **TWINT** -- Dominant Swiss mobile payment (not a bank, but a payment overlay). VoP integration could add trust layer.

**Pain points:** Need API-first solutions, fast integration, no legacy burden but limited compliance infrastructure.

### Tier 4: Swiss PSPs & Payment Processors

- **Worldline Switzerland** (ex-SIX Payment Services) -- Already a VoP provider in EU. Key partner or competitor.
- **SIX Group** -- Operator of SIC/euroSIC. Sets the standards.
- **Aduno Group / Viseca** -- Card processing, moving into account-to-account.
- **Datatrans** -- Swiss payment gateway.

### Tier 5: Corporates with High Payment Volumes

- **Swiss pharmaceutical companies** (Novartis, Roche) -- Massive cross-border EUR payments
- **Swiss commodity traders** (Glencore, Trafigura, Vitol) -- Zug-based, huge EUR flows
- **Swiss insurers** (Zurich, Swiss Re) -- Cross-border claims payments
- **Swiss watch/luxury** (Swatch Group, Richemont) -- Supplier payments across EU

**Use case:** Pre-validate payee names before bulk EUR payments to reduce failures and fraud.

---

## 5. Value Proposition

### Primary Message

> **"La Suisse doit etre VoP-ready avant fin 2027. Commencez aujourd'hui avec une API, pas un projet a 18 mois."**
>
> **"Die Schweiz muss bis Ende 2027 VoP-ready sein. Starten Sie heute mit einer API, nicht mit einem 18-Monats-Projekt."**

### Value Pillars

#### 1. Pre-validation Layer (Available Now)

IBANforge already validates IBANs, resolves BICs, checks SEPA reachability, and flags VoP coverage status. This is the **first step** any institution needs before implementing full VoP: know which IBANs are in VoP-covered jurisdictions and which banks participate.

#### 2. Regulatory Intelligence

- Per-IBAN VoP obligation status (mandatory / deferred / voluntary)
- SEPA Instant reachability check per BIC
- Country-level risk classification (sanctions, FATF)
- Issuer type detection (traditional bank vs EMI vs payment institution)

#### 3. Cost Efficiency

- No annual license, no minimum commitment
- Pay-per-call ($0.005-$0.02 per validation) or free tier (200/month)
- API-first: integrate in hours, not months
- x402 micropayments: no procurement/invoicing overhead

#### 4. AI-Ready Compliance

- MCP-native: AI agents can autonomously validate IBANs and check VoP status
- Perfect for compliance automation workflows
- Structured JSON responses designed for machine consumption

### Positioning vs Competition

| | IBANforge | SurePay | Worldline VoP | In-house |
|---|---|---|---|---|
| Pre-validation | Yes | No (full VoP only) | Partial | Custom |
| Pay-per-call | Yes ($0.005) | Enterprise pricing | Enterprise pricing | N/A |
| Swiss-specific | Yes (CH BBAN parsing) | EU-focused | EU-focused | Custom |
| Setup time | Hours | Months | Months | 12-18 months |
| MCP/AI integration | Native | No | No | No |
| Full name matching | Roadmap | Yes | Yes | Custom |

**IBANforge's sweet spot**: We are not (yet) a full VoP Responder/Requester. We are the **pre-validation and intelligence layer** that institutions need *right now* while they plan their full VoP implementation. We complement rather than replace SurePay/Worldline for the full inter-PSP VoP flow.

---

## 6. Required Features to Build

### Phase 1: VoP Intelligence Layer (Q2 2026) -- Enhance What Exists

**Goal:** Position IBANforge as the go-to tool for VoP readiness assessment.

- [ ] **VoP readiness endpoint**: `GET /v1/vop/readiness/:iban`
  - Returns: country VoP obligation status, timeline (mandatory since/from date), bank VoP participation status, SEPA Instant reachability, recommended actions
  - Special handling for CH: "voluntary but recommended -- euroSIC discontinuation forces SEPA direct participation"

- [ ] **Swiss bank code enrichment**: Map Swiss clearing numbers (5-digit bank codes from BBAN) to institution names, VoP readiness status, SIC Instant participation status

- [ ] **VoP participants database**: Seed from EPC VoP participant directory. Track which BIC8s are active VoP participants (Requester/Responder). Update monthly.

- [ ] **Compliance endpoint enhancement**: Add `vop_readiness` object to `/v1/iban/compliance` response with obligation date, participant status, and readiness score

- [ ] **Swiss-specific landing page**: FR + DE bilingual page targeting Swiss market

### Phase 2: VoP Pre-Check Service (Q3-Q4 2026)

**Goal:** Offer lightweight name-matching that helps institutions prepare before full VoP goes live.

- [ ] **Name similarity scoring**: `POST /v1/vop/pre-check`
  - Input: IBAN + expected payee name
  - Output: IBAN validation + BIC resolution + registered bank name + name similarity score (fuzzy matching)
  - *Not* a full VoP check (we don't query the receiving PSP), but a pre-screen

- [ ] **Bulk pre-check**: `POST /v1/vop/pre-check/batch`
  - Up to 1000 IBAN/name pairs
  - For corporates validating supplier payment files before submission
  - Price: $0.003/pair

- [ ] **Swiss institution directory**: Comprehensive mapping of Swiss bank codes to institution names, FINMA license type, SIC Instant status, cantonal bank flag

### Phase 3: VoP Proxy / Routing (2027)

**Goal:** Become an intermediary that routes VoP requests for institutions that don't want to build inter-PSP connectivity.

- [ ] **VoP Requester proxy**: Accept VoP requests from Swiss PSPs, route to the EPC VoP network via a partner (licensed VoP Routing Service provider)
  - Requires partnership with SurePay, Worldline, or similar RVM provider
  - Or: become an EPC VoP scheme participant directly

- [ ] **VoP analytics dashboard**: Show clients their VoP match rates, common mismatches, fraud prevention metrics

- [ ] **CHF VoP**: If FINMA mandates name-matching for domestic CHF transfers, offer the same service for SIC payments

### Technical Requirements

- VoP participant database (new SQLite table: `vop_participants`)
- Swiss bank directory (new SQLite table: `swiss_banks` with clearing numbers, names, SIC IP status)
- Name fuzzy matching library (Jaro-Winkler or similar, with Swiss name normalization: umlauts, "AG"/"SA"/"GmbH" handling)
- FR + DE landing page route
- API documentation update (OpenAPI spec)

---

## 7. Landing Page Structure (FR + DE)

### URL Structure

- `https://api.ibanforge.com/vop-suisse` (FR, default for .com)
- `https://api.ibanforge.com/vop-schweiz` (DE)
- Language toggle in header

### Page Sections

#### Hero

**FR:**
> # Verification of Payee pour la Suisse
> La reglementation EU impose VoP a tous les PSP SEPA d'ici juillet 2027.
> La Suisse n'est pas exemptee -- euroSIC ferme fin 2027.
> Preparez-vous maintenant avec l'API IBANforge.
> [Tester gratuitement] [Documentation API]

**DE:**
> # Verification of Payee fur die Schweiz
> Die EU-Regulierung macht VoP fur alle SEPA-PSPs bis Juli 2027 obligatorisch.
> Die Schweiz ist nicht ausgenommen -- euroSIC wird Ende 2027 abgeschaltet.
> Bereiten Sie sich jetzt vor mit der IBANforge API.
> [Kostenlos testen] [API-Dokumentation]

#### Section 1: "Pourquoi VoP est inevitable pour la Suisse" / "Warum VoP fur die Schweiz unvermeidbar ist"

- euroSIC timeline infographic (countdown to 31 Dec 2027)
- 3 paths: direct SEPA, correspondent banking, specialist provider
- All paths require VoP compliance
- FINMA APP fraud prevention direction

#### Section 2: "Ce que IBANforge offre aujourd'hui" / "Was IBANforge heute bietet"

- IBAN validation with VoP readiness flag
- BIC resolution with VoP participant status
- SEPA Instant reachability check
- Compliance risk scoring
- Interactive demo (same as main landing page but with Swiss IBAN examples: CH93 0076 2011 6238 5295 7)

#### Section 3: "Roadmap VoP" / "VoP Roadmap"

- Phase 1 (now): Intelligence layer
- Phase 2 (H2 2026): Pre-check name matching
- Phase 3 (2027): VoP proxy routing
- Timeline visualization aligned with regulatory deadlines

#### Section 4: "Pour qui?" / "Fur wen?"

- Cantonal banks: "Validez la prontitude VoP de vos correspondants"
- Fintechs: "Integrez la pre-validation VoP en quelques heures"
- Corporates: "Pre-screenez vos fichiers de paiement fournisseurs"
- Card with logos/icons for each segment

#### Section 5: "Pricing" / "Preise"

- Free tier: 200 requests/month
- Pay-per-call: from $0.003
- Enterprise: volume pricing on request
- x402 micropayments: no contract needed

#### Section 6: "FAQ"

- "La Suisse est-elle obligee d'implementer VoP?" / "Muss die Schweiz VoP implementieren?"
- "Quelle est la difference entre VoP et la validation IBAN?" / "Was ist der Unterschied zwischen VoP und IBAN-Validierung?"
- "IBANforge remplace-t-il SurePay?" / "Ersetzt IBANforge SurePay?"
- "Comment integrer l'API?" / "Wie integriere ich die API?"

#### Footer CTA

- Newsletter signup for VoP regulatory updates (FR + DE)
- "Contactez-nous pour un POC" / "Kontaktieren Sie uns fur einen POC"

### SEO Strategy

- Target keywords FR: "verification of payee suisse", "VoP API suisse", "conformite VoP banques suisses", "euroSIC fermeture 2027"
- Target keywords DE: "verification of payee schweiz", "VoP API schweiz", "VoP compliance schweizer banken", "euroSIC abschaltung 2027"
- Schema.org: FAQPage + WebAPI + Article
- Blog posts to drive organic traffic (see Outreach section)

---

## 8. Outreach Strategy

### Content Marketing (Immediate)

1. **Blog post FR**: "Fin d'euroSIC: ce que chaque banque suisse doit savoir sur VoP"
2. **Blog post DE**: "euroSIC-Abschaltung: Was jede Schweizer Bank uber VoP wissen muss"
3. **Technical guide**: "VoP Readiness Checklist for Swiss PSPs" (EN, for technical decision-makers)
4. **Infographic**: "Swiss Payments 2027: The VoP Timeline" (FR/DE/EN)

### Swiss Fintech Community

- **Swiss Finance + Technology Association (SFTA)**: Attend events, propose talk on VoP readiness
- **Swiss Fintech Innovations (SFTI)**: Join as associate member. They coordinate Swiss payment standards.
- **FintechNewsCH**: Pitch guest article on VoP implications for Switzerland
- **Crypto Valley Association**: Cross-promote (IBANforge uses x402/USDC, interesting angle)

### Direct Outreach

1. **LinkedIn targeting**: Payment/compliance heads at cantonal banks. Swiss banking LinkedIn is highly active.
2. **SIX Group events**: Attend SIC migration workshops. Position IBANforge as a complementary tool.
3. **FINMA regulatory sandboxes**: If applicable, register for innovation consultations.
4. **Swiss Bankers Association (SBA)**: Engage through working groups on payment modernization.

### Partnership Opportunities

- **SurePay**: Position IBANforge as a pre-validation layer that feeds into SurePay's full VoP. Joint go-to-market for Swiss institutions.
- **Worldline Switzerland**: They already offer VoP in EU. IBANforge could be the Swiss-specific intelligence layer.
- **Hypothekarbank Lenzburg (Finstar)**: They provide banking infrastructure for neon and other fintechs. Integration partnership could reach multiple neobanks at once.

### Conference Targets (2026-2027)

- **Swiss Payment Forum** (Zurich) -- Annual event, key decision-makers
- **Finance Forum Zurich** -- Broader finance audience
- **Point Zero Forum** (Zurich) -- Fintech/regtech focus
- **EBAday** (European) -- EPC/SEPA community, VoP is a hot topic

---

## 9. Timeline & Roadmap

### Q2 2026 (April-June) -- Foundation

| Week | Deliverable |
|------|------------|
| W1-2 | Build VoP participants database (seed from EPC directory) |
| W2-3 | Build Swiss bank directory (clearing numbers, institution names, SIC IP status) |
| W3-4 | Implement `GET /v1/vop/readiness/:iban` endpoint |
| W4-5 | Enhance compliance endpoint with `vop_readiness` object |
| W5-6 | Build FR + DE landing pages (`/vop-suisse`, `/vop-schweiz`) |
| W6-7 | Publish blog posts (FR + DE) on euroSIC + VoP |
| W7-8 | SEO optimization, submit to Google/Bing for indexing |

### Q3 2026 (July-September) -- Pre-Check Service

| Week | Deliverable |
|------|------------|
| W1-3 | Implement name fuzzy matching (Jaro-Winkler + Swiss normalization) |
| W3-5 | Build `POST /v1/vop/pre-check` endpoint |
| W5-6 | Build `POST /v1/vop/pre-check/batch` endpoint |
| W6-7 | MCP tools: `vop_readiness`, `vop_pre_check` |
| W7-8 | Update OpenAPI spec, publish technical documentation |
| W8-9 | Direct outreach to 5 cantonal banks (ZKB, BCV, BCGE, BEKB, LUKB) |

### Q4 2026 (October-December) -- Market Traction

| Month | Deliverable |
|-------|------------|
| Oct | Attend Swiss Payment Forum. First POC with a cantonal bank or fintech. |
| Nov | VoP Scheme Rulebook v2.0 published -- update landing page and blog |
| Dec | Swiss bank migration deadline (SIC Instant). Publish case study if POC complete. |

### H1 2027 (January-June) -- VoP Proxy

| Month | Deliverable |
|-------|------------|
| Jan | Non-eurozone SEPA receive deadline. Marketing push. |
| Feb-Apr | Build VoP Requester proxy (requires partner agreement with RVM provider) |
| May-Jun | Beta launch VoP proxy service for Swiss PSPs |

### H2 2027 (July-December) -- Full VoP

| Month | Deliverable |
|-------|------------|
| Jul | Non-eurozone VoP mandatory. Go-live with full proxy service. |
| Aug | euroSIC last EUR mandates (31 Aug). Content marketing push. |
| Dec | euroSIC shutdown. Position IBANforge as proven Swiss VoP infrastructure. |

---

## 10. Competitive Landscape

### Direct Competitors (Full VoP)

| Provider | Strengths | Weaknesses (for Swiss market) |
|----------|-----------|-------------------------------|
| **SurePay** | Market leader (10B+ checks since 2017), EPC scheme contributor, NL/BE/DK live | Enterprise pricing, no Swiss-specific features, long sales cycles |
| **Worldline** | Already present in CH (ex-SIX Payment Services), full VoP in EU | Enterprise only, bundled with other services |
| **Banxware / iDenfy** | KYC-integrated VoP | Not Swiss-focused |

### Adjacent Competitors (IBAN Validation)

| Provider | Strengths | Weaknesses |
|----------|-----------|------------|
| **IBAN.com** | Well-known, VoP page exists | No API intelligence layer, no Swiss focus |
| **Openiban.com** | Free, open-source | No VoP, no compliance |
| **APILayer IBAN** | Developer-friendly | No VoP, no compliance scoring |

### IBANforge Differentiation

1. **Swiss-specific intelligence**: CH BBAN parsing, Swiss bank directory, SIC Instant status
2. **API-first, no enterprise lock-in**: Pay-per-call from $0.003
3. **Compliance scoring**: Not just VoP, but sanctions + FATF + risk in one call
4. **AI-native**: MCP tools for autonomous compliance agents
5. **Regulatory intelligence**: Per-IBAN VoP obligation status with dates and rationale
6. **Speed to market**: Swiss institutions can start pre-validating today, not after an 18-month procurement cycle

---

## Appendix: Sources

- [EPC VoP Scheme Rulebook](https://www.europeanpaymentscouncil.eu/what-we-do/other-schemes/verification-payee)
- [EPC VoP Inter-PSP API Specifications (EPC103-24)](https://www.europeanpaymentscouncil.eu/sites/default/files/kb/file/2025-05/EPC103-24%20v1.0.1%20VOP%20API%20Specifications.pdf)
- [EU Instant Payments Regulation -- ECB](https://www.ecb.europa.eu/paym/retail/instant_payments/html/instant_payments_regulation.en.html)
- [Swiss Payments System Overhaul 2027 -- FintechNewsCH](https://fintechnews.ch/payments/switzerland-payments-overhaul-2027/82386/)
- [euroSIC Discontinuation Info Hub -- SIX](https://www.six-group.com/en/products-services/banking-services/interbank-clearing/eurosic/info-hub-discontinuation-eurosic.html)
- [SIX Instant Payments](https://www.six-group.com/en/products-services/banking-services/billing-and-payments/instant-payments.html)
- [SEPA Standards for Switzerland -- SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/sepa.html)
- [VoP Implementation in Switzerland -- CheckPayee](https://verification-of-payee.com/blog/implementing-vop-in-switzerland)
- [VoP Phase II: Non-Euro Nations -- Bottomline](https://www.bottomline.com/resources/blog/vop-phase-ii-psps-non-euro-nations-turn-compliance-competitive-edge)
- [PwC: VoP under EU IPR](https://legal.pwc.de/en/news/articles/verification-of-payee-requirements-vop-under-the-eus-instant-payments-regulation-ipr)
- [Taylor Wessing: IPR VoP Requirements](https://www.taylorwessing.com/en/insights-and-events/insights/2025/10/instant-payments-regulation)
- [SurePay Developer Portal](https://developer.surepay.nl/vop-for-banks/introduction)
- [Worldline VoP Switzerland](https://worldline.com/en-ch/home/main-navigation/solutions/financial-institutions/open-banking-solutions/verification-of-payee)
- [EBA-ECB 2025 Payment Fraud Report](https://www.ecb.europa.eu/press/intro/publications/pdf/ecb.ebaecb202512.en.pdf)
- [Deloitte: EU Payment Fraud Regulations for Switzerland](https://www.deloitte.com/ch/en/Industries/financial-services/blogs/eu-payment-fraud-regulations.html)
- [Chambers: Banking Regulation 2026 Switzerland](https://practiceguides.chambers.com/practice-guides/banking-regulation-2026/switzerland/trends-and-developments)
