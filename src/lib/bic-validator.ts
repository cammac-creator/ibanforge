import type { BICValidationResult } from '../types.js';

// ISO 3166-1 alpha-2 country codes (subset used by SWIFT)
const VALID_COUNTRIES = new Set([
  'AD','AE','AF','AG','AI','AL','AM','AO','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR',
  'BS','BT','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM',
  'CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ',
  'EC','EE','EG','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD',
  'GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GT','GU','GW','GY',
  'HK','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
  'JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME',
  'MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV',
  'MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU',
  'NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW',
  'PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI',
  'SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF',
  'TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG',
  'US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','XK','YE','YT',
  'ZA','ZM','ZW',
  // SWIFT special codes
  'XX', // Test/internal
]);

const BIC_REGEX = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/**
 * Validate a BIC/SWIFT code per ISO 9362
 */
export function validateBIC(input: string): BICValidationResult {
  const cleaned = input.replace(/\s/g, '').toUpperCase();

  if (cleaned.length !== 8 && cleaned.length !== 11) {
    return {
      bic: cleaned,
      valid: false,
      error: cleaned.length < 8 ? 'too_short' : cleaned.length > 11 ? 'too_long' : 'invalid_length',
    };
  }

  if (!BIC_REGEX.test(cleaned)) {
    return {
      bic: cleaned,
      valid: false,
      error: 'invalid_format',
    };
  }

  const institutionCode = cleaned.substring(0, 4);
  const countryCode = cleaned.substring(4, 6);
  const locationCode = cleaned.substring(6, 8);
  const branchCode = cleaned.length === 11 ? cleaned.substring(8, 11) : 'XXX';

  if (!VALID_COUNTRIES.has(countryCode)) {
    return {
      bic: cleaned,
      valid: false,
      error: 'invalid_country',
    };
  }

  const bic8 = cleaned.substring(0, 8);
  const bic11 = bic8 + branchCode;

  // Test BIC: second char of location code is "0"
  const isTestBic = locationCode[1] === '0';

  return {
    bic: cleaned,
    valid: true,
    bic8,
    bic11,
    institution_code: institutionCode,
    country_code: countryCode,
    location_code: locationCode,
    branch_code: branchCode,
    is_test_bic: isTestBic,
  };
}
