# Source documents

Two PDFs sit in this directory when the project is set up locally, and neither is
committed:

- `CIS_Microsoft_365_Foundations_Benchmark_v7.0.0.pdf` (4.0 MB)
- `CIS_Microsoft_Azure_Foundations_Benchmark_v6.0.0.pdf` (4.4 MB)

They are excluded deliberately. CIS distributes its benchmarks under its own
terms, and redistributing an 8 MB copy through a public repository is not
something this project needs to do: everything derived from them is already here,
cited to the page, and the files themselves are free to download from CIS with a
registration.

> https://www.cisecurity.org/cis-benchmarks

Nothing in the repository reads these files. They were uploaded to the Sanity
Context knowledge base through the Context app's own file source, and read by
hand with `pdftotext` to verify each claim before it was written into
`scripts/seed-baselines.ts`. Cloning the repository and running the import
scripts works without them.

## What was taken from them

Every `baselineControl` document carries `sourceAuthority` and `sourceLocation`,
so each claim points back at the section and page it came from and can be checked
against the original. The contested ones are listed in the README.

To rebuild the knowledge base, download both PDFs into this directory and add
them as **file** sources on the Knowledge Base endpoint. `CONTEXT-SETUP.md` has
the rest, including the mistake that cost a rebuild: adding documentation
*directory* URLs as website sources instead of leaf pages, which indexed 157
documents from one URL and blew through the plan's limit.

## Other sources, not stored here at all

- **MITRE ATT&CK Enterprise**, from the STIX bundle at
  `mitre-attack/attack-stix-data`. Fetched at import time by
  `scripts/import-attack.ts`.
- **Microsoft Sentinel detection rules**, from the public
  `Azure/Azure-Sentinel` repository. Cloned at import time; `README.md` has the
  sparse-checkout command, which matters because a full clone is 2.5 GB.
- **Microsoft Learn documentation**, indexed by URL as website sources on the
  knowledge base endpoint. Never copied.
