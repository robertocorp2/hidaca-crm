# Canonical field dictionary

| Source concept                         | Canonical destination                       | UI destination                                  |
| -------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| Cliente / Business Name                | `businesses.name`                           | Business overview and quotation summary         |
| Organization/person                    | `businesses.customer_type`                  | Business form and overview                      |
| RNC/cÃ©dula                            | `businesses.rnc`, `normalized_rnc`          | Business form, overview, search                 |
| Email/phone/mobile                     | Business and Contact identity fields        | Business/Contact forms, lists, detail, search   |
| Project and address                    | `projects`, `addresses`                     | Business related sections and quotation summary |
| Quote number/year/type                 | `quotations`                                | Normalized quotation list/detail/search         |
| Revision/alternative/date              | `quotation_revisions`                       | Revision picker and quote summary               |
| Description/quantity/location          | `quotation_line_items`                      | Quote line table                                |
| Opening/finished dimensions/area       | `measurements` and line fields              | Quote measurements column                       |
| Unit, mÂ², and flat pricing            | line price-basis and price fields           | Quote price and total columns                   |
| Subtotal/discount/ITBIS/total          | `quotation_financials`, `quotation_charges` | Quote financial card                            |
| Advance/partial/final payment          | `payments`                                  | Business and quotation payment sections         |
| Validity/payment/warranty/policies     | `quotation_terms`                           | Quote terms section                             |
| Production/despiece/materials/formulas | manufacturing tables                        | Role-gated internal production section          |
| Original file/path/hash/parser         | `documents`, `import_files`                 | Import summary and protected documents          |
| Raw/unmapped/formula value             | `source_field_values`                       | Source-to-record review table                   |
| Warning/duplicate/conflict             | `import_issues`, `import_candidates`        | Import review decisions                         |

Every other nonblank extracted value is retained as unmapped source evidence;
it is not silently discarded.
