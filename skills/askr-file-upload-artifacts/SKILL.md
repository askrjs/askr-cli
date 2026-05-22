---
name: askr-file-upload-artifacts
description: Use when building Askr file uploads, generated artifacts, progress, previews, validation, storage adapters, downloads, open flows, virus-scan or processing states, and event-sourced artifact readiness.
---

# Askr File Upload Artifacts

Use this for uploads, downloads, previews, and generated files.

## Inspect First

- Adapter support for upload URLs, multipart uploads, or artifact APIs.
- Feature workflow for create/upload/process/download.
- File validation rules: type, size, count, privacy, retention.
- Artifact processing states and event stream support.

## Boundary Model

- `src/adapters`: upload transport, signed URL calls, artifact downloads.
- `src/features/<feature>`: validation, upload workflow, artifact query/mutation state.
- `src/components/shared`: reusable file picker, progress list, preview shell.
- `src/shared`: size formatting, safe filename helpers, error normalization.

## UX States

- Selected but not uploaded.
- Uploading with progress.
- Uploaded but processing.
- Ready for preview/download.
- Failed validation.
- Failed upload.
- Failed processing.
- Deleted or expired.

## Eventual Consistency

- Treat upload completion and artifact readiness as separate states.
- If processing is event-sourced, show "processing" until the artifact-ready event or projection appears.
- Preserve artifact ID, upload ID, processing job ID, and last event ID.
- Allow refresh/retry without duplicating uploads where possible.

## Avoid

- Pretending an artifact is ready immediately after upload when processing is asynchronous.
- Client-only validation as the only protection.
- Losing progress and error state on route-local rerenders.
- Download links without accessible names or file metadata.

## Checks

- Validation, upload, processing, ready, and failure states are visible.
- Upload cancellation or retry behavior is explicit.
- Large files and unsupported types fail clearly.
- Artifact readiness is reconciled from server state.
