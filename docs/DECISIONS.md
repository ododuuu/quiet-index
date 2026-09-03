# Decision log

## D001 — Use Node.js and TypeScript

- Status: accepted
- Decision: target Node.js 22.17.0 x64 and write application code in strict TypeScript.
- Reason: the company computer can run Node.js, npm packages were technically verified, and no usable .NET SDK is installed.

## D002 — Use only local document processing

- Status: accepted
- Decision: parsing, indexing, and searching remain on the user's computer.
- Reason: company document contents must not be assumed safe to transmit to external AI or embedding services.

## D003 — Make multi-format search part of the usable MVP

- Status: accepted
- Decision: the usable MVP includes Markdown, text, DOCX, PPTX, XLSX, and text-based PDF.
- Reason: a Markdown-only tool does not solve the user's actual document-search problem.

## D004 — Deliver formats incrementally through one common model

- Status: accepted
- Decision: prove the full scan-to-search path with Markdown/text first, then add Office and PDF parsers without changing the search core.
- Reason: this controls implementation risk without redefining the final product as Markdown-only.

## D005 — Prefer packages already tested in the company environment

- Status: accepted with policy caveat
- Decision: plan around `fflate`, `fast-xml-parser`, and `pdfjs-dist`; use Node's built-in SQLite when feasible.
- Reason: those packages imported successfully on the company computer, although technical success is not equivalent to formal company approval.
