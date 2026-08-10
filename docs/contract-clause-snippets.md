# Contract Clause Snippets

Reference language adapted from Lumetry Media’s prior service contracts. Wording stays close to the original; light edits improve clarity and consistency with current CRM merge fields.

**Suggested merge fields:** `{{our_company}}`, `{{client_name}}`, `{{client_company_clause}}`, `{{project_dates}}`, `{{investment}}`, `{{service_name}}`, `{{service_role}}`, `{{photo_delivery}}`, `{{video_delivery}}`

Use **Provider** for the company and **{{service_role}}** (e.g. Photographer, Videographer) where role-specific language helps. Paste into Admin → Contract clauses; attach categories so clauses auto-include with matching quote services.

### Delivery tokens (resolved from the quote)

| Token | Behavior |
|-------|----------|
| `{{photo_delivery}}` | Default: within 48 hours after the event via online gallery. If **Live Gallery** is on every photography day → realtime Live Gallery. If only on some days → mixed wording (live on included days, 48 hours otherwise). |
| `{{video_delivery}}` | From Highlight Video Edit SKUs: Same Day and/or 1 Week. If no edit SKU → “according to the post-production option selected in the accepted quote” (no fixed timeline). |

---

## Services (intro)

**Suggested name:** Services Overview  
**Include when:** Always (or with any production category)  
**Categories:** — / always include

### Body

**Services**

The following is a breakdown of each service to be provided in accordance with this contract:

---

## Event Photography

**Suggested name:** Event Photography Description  
**Categories:** Photography

### Body

**Event Photography:** Professional photographic coverage of the event, including attendees, speakers, seminars, activations, and general event activities.

Provider will supply professional photography coverage as described in the accepted quote. Client will receive edited, high-resolution images delivered {{photo_delivery}}. RAW/unedited files are not included.

---

## Event Videography

**Suggested name:** Event Videography Description  
**Categories:** Videography

### Body

**Event Videography:** Comprehensive video coverage of the event, capturing attendees, presenters, seminars, and key moments throughout the day(s).

Provider will supply professional videography coverage as described in the accepted quote. Edited video deliverables will be provided {{video_delivery}}. Raw footage is not included unless specified in the quote.

---

## Headshot Booth

**Suggested name:** Headshot Booth Description  
**Categories:** Headshot Booth

### Body

**Headshot Booth:** A dedicated headshot station providing high-quality, professionally lit portraits for event attendees.

---

## House Rules

**Suggested name:** House Rules  
**Categories:** Photography, Videography, Headshot Booth (or always include for on-site work)

### Body

**HOUSE RULES:** The {{service_role}} is limited by the guidelines of the event site management. Client agrees to accept the technical results of those guidelines’ imposition on the {{service_role}}. Negotiation with officials for moderation of guidelines is Client’s responsibility; the {{service_role}} will offer technical recommendations only.

The {{service_role}} will not video record or photograph any event in the rain or other inclement weather that would damage equipment. If weather conditions prohibit photography and/or videography of the event, in part or in whole, and arrangements have not been made to move the event indoors, any retainer and other moneys paid are non-refundable.

Aerial footage is available only if weather permits and airspace is clear of obstructions, including power lines, tall buildings, pedestrians, and trees.

---

## Film and Copyrights

**Suggested name:** Film and Copyrights  
**Categories:** Photography, Videography, Headshot Booth

### Body

**FILM AND COPYRIGHTS:** Until final payment for services is made, the images and videos produced by the {{service_role}} are protected by Federal Copyright Law (all rights reserved) and may not be reproduced in any manner without the {{service_role}}’s explicit written permission. Upon full payment, Client receives a non-exclusive license for personal and internal business use, unless otherwise agreed in writing. {{our_company}} may use selected images and video for portfolio and marketing purposes unless Client opts out in writing.

---

## Limit of Liability

**Suggested name:** Limit of Liability  
**Include when:** Always  
**Categories:** —

### Body

**LIMIT OF LIABILITY:** In the unlikely event that the {{service_role}} is injured or becomes too ill to cover the event, the {{service_role}} will make every effort to secure a replacement. If a suitable replacement is not found, responsibility and liability are limited to the return of all payments received for the event package.

The {{service_role}} takes the utmost care with respect to exposure, transportation, and processing of images and videos. However, in the unlikely event that images and/or videos have been lost, stolen, or destroyed for reasons within or beyond the {{service_role}}’s control, the {{service_role}}’s liability is limited to the return of all payments received for the event. The limit of liability for a partial loss of originals shall be a prorated amount based on the percentage of total footage or images lost.

---

## Booth Service Period

**Suggested name:** Headshot Booth Service Period  
**Categories:** Headshot Booth

### Body

**BOOTH SERVICE PERIOD:** Provider agrees to have {{our_company}}’s Headshot Booth operational for a minimum of 80% of the contracted service period. Occasionally, operations may need to be interrupted for maintenance of the Headshot Booth.

---

## Retainer

**Suggested name:** Retainer  
**Include when:** Always  
**Categories:** —

### Body

**RETAINER:** A retainer of 50% of {{investment}} is due once the contract has been signed. In the event of cancellation, the retainer paid is non-refundable. Client agrees to provide cancellation notice in writing and releases the {{service_role}} from any further responsibilities and liabilities related to the cancelled engagement.

---

## Optional combined “Production Terms” (single clause)

If you prefer fewer clauses, this packs House Rules + Copyright + Liability into one always-on production block. Keep Booth Service Period and Retainer separate.

### Body

**HOUSE RULES:** The {{service_role}} is limited by the guidelines of the event site management. Client agrees to accept the technical results of those guidelines’ imposition on the {{service_role}}. Negotiation with officials for moderation of guidelines is Client’s responsibility; the {{service_role}} will offer technical recommendations only. The {{service_role}} will not video record or photograph any event in the rain or other inclement weather that would damage equipment. If weather conditions prohibit photography and/or videography of the event, in part or in whole, and arrangements have not been made to move the event indoors, any retainer and other moneys paid are non-refundable. Aerial footage is available only if weather permits and airspace is clear of obstructions, including power lines, tall buildings, pedestrians, and trees.

**FILM AND COPYRIGHTS:** Until final payment for services is made, the images and videos produced by the {{service_role}} are protected by Federal Copyright Law (all rights reserved) and may not be reproduced in any manner without the {{service_role}}’s explicit written permission. Upon full payment, Client receives a non-exclusive license for personal and internal business use, unless otherwise agreed in writing.

**LIMIT OF LIABILITY:** In the unlikely event that the {{service_role}} is injured or becomes too ill to cover the event, the {{service_role}} will make every effort to secure a replacement. If a suitable replacement is not found, responsibility and liability are limited to the return of all payments received for the event package. In the unlikely event that images and/or videos have been lost, stolen, or destroyed for reasons within or beyond the {{service_role}}’s control, liability is limited to the return of all payments received for the event. Partial loss of originals shall be prorated based on the percentage of total footage or images lost.

---

## Notes

These snippets are seeded into the live clause library via `DEFAULT_TEMPLATES` in `lib/crm-models.js` (upserted by name on server start / CRM migrate).

| Snippet | Template name |
|---------|----------------|
| Services intro + Agreement / Payment | General Terms |
| Retainer | Retainer |
| Event Photography | Photography Terms |
| Event Videography | Videography Terms |
| Headshot Booth + Booth Service Period | Headshot Booth Terms |
| House Rules | House Rules |
| Film and Copyrights | Film and Copyrights |
| Limit of Liability | Limit of Liability |

Edit further in Admin → Contracts if you want to tweak wording per install.
