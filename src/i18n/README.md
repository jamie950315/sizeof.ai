# Site localization

The English message catalog covers application and Worker prose, React JSX,
documentation, accessibility labels, errors, metadata, exported report lines,
and documentation diagram labels. It deliberately includes some extra internal
strings; catalog presence is not a promise that every string is rendered.
Technical units, repository identities, publisher names, commands, and HTTP
headers remain unchanged. User-entered data must never be translated remotely.

## Maintaining catalogs

```sh
node scripts/i18n-catalog.mjs --extract --write
node scripts/i18n-catalog.mjs --write
# Or update only a selected locale:
node scripts/i18n-catalog.mjs zh-TW --write
node scripts/localize-diagrams.mjs
```

The extractor uses the installed TypeScript 7 AST API, including React's JSX
whitespace normalization and numbered template placeholders. Without `--write`,
commands print patches rather than changing files; large patch output can be
truncated by terminal wrappers, so use `--write` for generated catalogs.

Existing translations are reused, then the checked-in technical and Chinese
terminology glossary is reapplied. New public source copy is machine-translated
at build time through Google's free `translate.googleapis.com` gtx endpoint,
without an API key. There are no translation calls from visitors' browsers and
no credential, private user content, or model-weight uploads. Translation calls
have bounded request sizes, deadlines, concurrency, and retries; rate limiting
fails the run rather than evading a provider block or writing an incomplete
locale. The free endpoint is unofficial and availability is not guaranteed.

The initial 2026-09-14 catalogs were machine-generated, with model-authored
completion of a small number of missing public labels and source-context
technical/Chinese terminology corrections after the endpoint returned HTTP 429.
They have not received comprehensive native-speaker review. Future linguistic
corrections should be made directly in locale JSON; generation preserves them.

The browser downloads only the selected locale pack; the server loads the full
catalog set for localized documentation HTML and Markdown. A failed language
switch keeps the previous language and current form data. Initial asset failure
falls back to English with visible feedback without discarding URL settings.

The build checks source-catalog drift and refuses missing or invalid translations.
All locales must have the same keys as `messages.json` and exactly preserve each
message's numbered placeholders. Run localization tests, the full test suite,
build, diagram generation, and browser checks after changes. Translation quality,
visual overflow, persistence, cross-page navigation, RTL layout, exports, and
non-JavaScript documentation require verification beyond key coverage.
