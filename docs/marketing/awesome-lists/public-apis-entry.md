# Entry for public-apis/public-apis

**Repository:** https://github.com/public-apis/public-apis  
**Stars:** 250K+  
**Category:** Finance  
**Status:** Ready to submit PR

## How to Contribute

1. Fork https://github.com/public-apis/public-apis
2. Edit `README.md`
3. Find the **Finance** section (search for `### Finance`)
4. Add the entry below in **alphabetical order** (between entries starting with 'H' and 'J')
5. Submit a Pull Request

## Exact Line to Add

The Finance section header format is:

```
### Finance
API | Description | Auth | HTTPS | CORS |
|---|:---|:---|:---|:---|
```

**Entry to insert (alphabetical order — after entries starting with 'H', before 'J'):**

```
| [IBANforge](https://api.ibanforge.com) | IBAN validation and BIC/SWIFT lookup for 75+ countries with 39K+ bank entries | No | Yes | Yes |
```

## Full Context (surrounding entries for reference)

```markdown
| [Glean](https://developer.glean.com/docs/browser_api/overview/) | Company productivity platform search and assistant API | `apiKey` | Yes | Unknown |
| [IBANforge](https://api.ibanforge.com) | IBAN validation and BIC/SWIFT lookup for 75+ countries with 39K+ bank entries | No | Yes | Yes |
| [IEX Cloud](https://iexcloud.io/docs/api/) | Realtime & Historical Stock and Market Data | `apiKey` | Yes | Yes |
```

## Notes

- Auth is `No` because IBANforge offers free tier with no API key required (x402 micropayments are optional)
- CORS is `Yes` — confirmed via API response headers
- The free `/v1/demo` and `/health` endpoints work without any authentication
- Homepage: https://ibanforge.com
- API base: https://api.ibanforge.com
- Docs: https://ibanforge.com/docs
