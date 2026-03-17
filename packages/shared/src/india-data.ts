/**
 * Reference data for Indian states, UTs, and Punjab districts.
 * Used by FormRenderer and Onboarding to populate dropdowns.
 */

/** All 23 districts of Punjab */
export const PUNJAB_DISTRICTS = [
  "Amritsar",
  "Barnala",
  "Bathinda",
  "Faridkot",
  "Fatehgarh Sahib",
  "Fazilka",
  "Firozpur",
  "Gurdaspur",
  "Hoshiarpur",
  "Jalandhar",
  "Kapurthala",
  "Ludhiana",
  "Malerkotla",
  "Mansa",
  "Moga",
  "Mohali (SAS Nagar)",
  "Muktsar (Sri Muktsar Sahib)",
  "Nawanshahr (SBS Nagar)",
  "Pathankot",
  "Patiala",
  "Rupnagar",
  "Sangrur",
  "Tarn Taran",
] as const;

/** Indian states and union territories (alphabetical) */
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  // Union Territories
  "Andaman & Nicobar Islands",
  "Chandigarh",
  "Dadra & Nagar Haveli and Daman & Diu",
  "Delhi",
  "Jammu & Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

/** Helper: convert a string array to { value, label } options for <select> / enum fields */
export function toSelectOptions(items: readonly string[]): Array<{ value: string; label: string }> {
  return items.map((item) => ({ value: item, label: item }));
}
