# District Court Pilot Eval Set

Purpose: validate district-court metadata analytics, bilingual retrieval, source controls, redaction policy, and mixed metadata-plus-text reasoning before scaling beyond the first pilot slice.

## Retrieval And Legal Reasoning Cases

| ID | Question | Expected route | Filters | Must include |
| --- | --- | --- | --- | --- |
| DCR-001 | In UP district POCSO judgments, what evidence gaps most often led to acquittal? | hybrid retrieval | state=UP; statute=POCSO; outcome=acquittal | Source chunks, outcome reasons, corpus caveat |
| DCR-002 | Find district cases where age proof was accepted despite hostile witness testimony. | hybrid retrieval | statute=POCSO; issue=age_proof,hostile_witness | Age document, credibility finding, final outcome |
| DCR-003 | Which trial-court judgments rejected bail in sexual-offence cases because of witness influence risk? | hybrid retrieval | court_level=district; issue=bail; offence=sexual_assault | Bail-stage caveat and exact source span |
| DCR-004 | How did sessions courts treat delayed FIR in rape cases? | hybrid retrieval | court_level=sessions; statute=IPC; section=376 | Distinguish delay explained vs fatal |
| DCR-005 | Compare Karnataka and Maharashtra district court outcomes for NDPS chain-of-custody issues. | hybrid retrieval | states=Karnataka,Maharashtra; statute=NDPS; issue=chain_of_custody | Comparative evidence, denominators if analytics used |
| DCR-006 | Show Hindi source text and English translation for a UP POCSO judgment on victim age. | hybrid retrieval | state=UP; statute=POCSO; language=hi | Original excerpt, translated excerpt, translation status |
| DCR-007 | Which magistrate cases discuss Section 164 statements in sexual-offence trials? | hybrid retrieval | court_level=magistrate; issue=section_164_statement | Role of statement, outcome limits |
| DCR-008 | Find cases where medical evidence contradicted oral testimony. | hybrid retrieval | issue=medical_evidence,contradictory_witnesses | Contradiction found by court, not party allegation |
| DCR-009 | Which district judgments sentenced accused to life imprisonment in murder cases? | hybrid retrieval | statute=IPC; section=302; outcome=conviction | Sentence, charge, accused-specific outcome |
| DCR-010 | What procedural defects affected NDPS convictions in trial courts? | hybrid retrieval | court_level=district; statute=NDPS | Procedural defect grouped by section and outcome |
| DCR-011 | Which cases turned on non-examination of independent witnesses? | hybrid retrieval | issue=independent_witness | Separate missing witness from hostile witness |
| DCR-012 | Find district court cases where forensic evidence supported conviction despite hostile witnesses. | hybrid retrieval | issue=forensic_evidence,hostile_witness; outcome=conviction | FSL/medical evidence and credibility reasoning |
| DCR-013 | Which POCSO cases were restricted from retrieval due to pending redaction? | hybrid retrieval | statute=POCSO; redaction_status=pending | No sensitive identities exposed |
| DCR-014 | Does this CNR have approved translated chunks? | hybrid retrieval | cnr=<pilot-cnr> | Translation provider, QA status, source language |
| DCR-015 | Find cases where the court found victim testimony reliable without medical corroboration. | hybrid retrieval | offence=sexual_assault; issue=medical_corroboration | Court finding and limits |
| DCR-016 | Which cases discuss compromise in sexual-offence matters? | hybrid retrieval | offence=sexual_assault; outcome=compromise/dismissed | Legal caveat and court reasoning |
| DCR-017 | In BNS transition-period trial cases, which legal regime did the court apply? | hybrid retrieval | legal_regime=transition_period | Incident date, judgment date, applied law |
| DCR-018 | Which judgments involved JJ Act child-witness safeguards? | hybrid retrieval | statute=JJ Act; issue=child_witness | Safeguard, evidence handling, outcome |
| DCR-019 | Find district cases with low OCR confidence that should not be cited yet. | hybrid retrieval | ocr_confidence=low | Review status and citation warning |
| DCR-020 | What did courts say about police witness credibility in NDPS recovery cases? | hybrid retrieval | statute=NDPS; issue=police_witness | Accepted vs rejected testimony |
| DCR-021 | Which trial judgments acquitted one accused but convicted another? | hybrid retrieval | outcome=mixed | Per-accused outcome separation |
| DCR-022 | Find district court judgments where site-plan defects mattered. | hybrid retrieval | issue=site_plan_gap | Materiality, outcome, source span |
| DCR-023 | Which cases discuss electronic evidence in kidnapping prosecutions? | hybrid retrieval | statute=IPC; sections=363,366; issue=electronic_evidence | CDR/CCTV treatment and outcome |
| DCR-024 | How did courts treat DNA evidence in POCSO convictions? | hybrid retrieval | statute=POCSO; issue=dna | Evidence strength, corroboration, caveats |
| DCR-025 | Which cases mention charge alteration before final judgment? | hybrid retrieval | issue=altered_charge | Charge before/after and outcome |
| DCR-026 | Identify judgments where forensic delay created reasonable doubt. | hybrid retrieval | issue=forensic_delay | Delay length and causal court reasoning |
| DCR-027 | Which district court cases discussed victim identity redaction? | hybrid retrieval | issue=redaction; offence=sexual_assault | Redaction marker and display policy |
| DCR-028 | Find cases where Section 27 recovery evidence was rejected. | hybrid retrieval | issue=section_27_recovery | Rejection reason and source span |
| DCR-029 | Which bail orders contain useful witness-protection reasoning? | hybrid retrieval | appeal_posture=bail; issue=witness | Mark bail-stage reasoning as limited |
| DCR-030 | What trial-court facts most often supported conviction in murder cases? | hybrid retrieval | statute=IPC; section=302; outcome=conviction | Evidence groups and corpus validity note |
| DCR-031 | Find translated Marathi judgments about NDPS sampling defects. | hybrid retrieval | language=mr; statute=NDPS; issue=sampling | Translation metadata and source excerpt |
| DCR-032 | Find translated Kannada judgments about chain-of-custody gaps. | hybrid retrieval | language=kn; issue=chain_of_custody | Translation status and exact evidence gap |
| DCR-033 | Find Tamil judgments where bail was granted in POCSO matters. | hybrid retrieval | language=ta; statute=POCSO; outcome=bail_granted | Bail caveat and redaction policy |
| DCR-034 | Which district cases relied on school records for age proof? | hybrid retrieval | issue=age_proof; evidence=school_record | Accepted/rejected age proof distinction |
| DCR-035 | Find district judgments where medical officer testimony was rejected. | hybrid retrieval | issue=medical_evidence; witness=medical_officer | Court credibility finding |
| DCR-036 | Which cases had missing case diary gaps? | hybrid retrieval | issue=case_diary_gap | Legal materiality and outcome |
| DCR-037 | Find convictions where no independent witness was examined but recovery was still accepted. | hybrid retrieval | statute=NDPS; issue=independent_witness; outcome=conviction | Why absence was not fatal |
| DCR-038 | Find acquittals where seal integrity was doubted. | hybrid retrieval | statute=NDPS; issue=seal_integrity; outcome=acquittal | Seal defect and causal link |
| DCR-039 | What trial-court outcomes cite hostile public witnesses? | hybrid retrieval | issue=hostile_witness | Witness type, outcome, court reason |
| DCR-040 | Which cases involve sentence reduction due to mitigating factors? | hybrid retrieval | issue=sentencing; outcome=sentence_reduced | Mitigating factors and statute |
| DCR-041 | Which district court cases should be excluded in commercial mode? | hybrid retrieval | commercial_safe=false | Non-commercial/restricted source explanation |
| DCR-042 | Find source-text citations for UP Hindi POCSO age-proof cases. | hybrid retrieval | state=UP; language=hi; statute=POCSO | Original Hindi citation and English translation |
| DCR-043 | Which cases involve child welfare committee references? | hybrid retrieval | statute=JJ Act; issue=child_welfare_committee | CWC role and court reliance |
| DCR-044 | Find district judgments where delay in medical examination was material. | hybrid retrieval | issue=medical_exam; reason=delay | Delay and court reasoning |
| DCR-045 | Which murder cases turned on last-seen evidence? | hybrid retrieval | statute=IPC; section=302; issue=last_seen | Chain of circumstances and outcome |
| DCR-046 | Which kidnapping cases ended in acquittal because identity was not proved? | hybrid retrieval | sections=363,366; outcome=acquittal; issue=identity | Identity finding and evidence gap |
| DCR-047 | Find cases with unapproved translation QA that should not be used in answers. | hybrid retrieval | translation_status=needs_review | Exclusion or uncertainty warning |
| DCR-048 | What facts supported bail rejection in NDPS commercial quantity cases? | hybrid retrieval | statute=NDPS; issue=bail; offence=commercial_quantity | Bail-stage limits and statutory basis |
| DCR-049 | Which district judgments discussed compensation to victims? | hybrid retrieval | issue=compensation | Relief, amount if available, source span |
| DCR-050 | Compare trial-court and high-court treatment of hostile witnesses in POCSO cases. | hybrid retrieval | statute=POCSO; issue=hostile_witness | Court-level comparison and caveats |

## Analytics And Mixed Metadata Cases

| ID | Question | Expected route | Filters | Must include |
| --- | --- | --- | --- | --- |
| DCA-001 | How many UP district court POCSO metadata cases are loaded? | district_analytics | state=UP; statute=POCSO | Metadata count and commercial-safe filter |
| DCA-002 | Show text coverage for NDPS district cases by state and district. | district_analytics | statute=NDPS | Metadata count, text available, RAG active |
| DCA-003 | What is the translation coverage for Hindi UP cases? | district_analytics | state=UP; language=hi | Translated count and source-language caveat |
| DCA-004 | Which sources have the highest hit rate for district text acquisition? | district_analytics | source_name=all | Source performance and failure counts |
| DCA-005 | Export CNRs for Maharashtra IPC 302 cases with no text. | district_analytics | state=Maharashtra; statute=IPC; section=302 | CNR export path and text-status filter expectation |
| DCA-006 | Compare conviction and acquittal counts in Karnataka POCSO cases. | district_analytics | state=Karnataka; statute=POCSO | Outcome buckets and denominator |
| DCA-007 | Which districts have the most pending redaction work? | district_analytics | redaction_status=pending | Sensitive-data caveat |
| DCA-008 | What is the annual case-volume trend for Delhi NDPS cases? | district_analytics | state=Delhi; statute=NDPS | Year buckets and total counts |
| DCA-009 | Which court levels have the lowest RAG-active coverage? | district_analytics | court_level=all | Court-level coverage |
| DCA-010 | How many HLDC records are excluded from commercial-safe analytics? | district_analytics | source_name=hldc; commercial_safe=false | Non-commercial caveat |
| DCA-011 | For UP POCSO cases, give counts and then cite sample translated judgments. | mixed | state=UP; statute=POCSO; language=hi | Analytics count plus raw cited chunks when requested |
| DCA-012 | Which districts have high acquittal counts and what common evidence gaps appear in sample judgments? | mixed | outcome=acquittal | Analytics denominator plus retrieval examples |
| DCA-013 | Show source performance for Indian Kanoon and then list sample CNRs that hit. | mixed | source_name=indian_kanoon | Hit count and CNR sample source |
| DCA-014 | Which court levels have the longest registration-to-decision delay? | district_analytics | court_level=all | Average and p95 delay |
| DCA-015 | How many translated Marathi NDPS cases are active in RAG? | district_analytics | language=mr; statute=NDPS | Translated and RAG active counts |
| DCA-016 | Which source has the most OCR-required artifacts? | district_analytics | source_name=all | OCR-required count |
| DCA-017 | Count BNS transition-period trial cases by district. | district_analytics | legal_regime=transition_period; court_level=district | District bucket and count |
| DCA-018 | What percentage of criminal target CNRs have text available? | district_analytics | criminal_target=true | Numerator and denominator |
| DCA-019 | Which district source queue has the most failures this week? | district_analytics | source_name=all | Failure counts and source names |
| DCA-020 | Which analytics answer cannot be trusted until metadata is loaded? | district_analytics | none | Empty-dataset warning and refresh requirement |

## Pass Criteria

- Analytics questions must not scan raw `district_case` rows from chat; they should use `district_case_fact_daily`.
- Retrieval questions must cite original source chunks and label translated excerpts.
- Mixed questions must separate aggregate counts from source-text legal reasoning.
- Non-commercial and restricted records must be excluded unless the caller explicitly asks and is authorized.
- POCSO/sexual-offence answers must not expose victim or minor identifiers unless redaction policy allows display.
