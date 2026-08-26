# Security policy

Braille Input Engine is experimental, community-supported, best effort, and has no SLA. It does not connect to a network, collect telemetry, persist text, or keep a production output history. Diagnostics do not include target text, DOM targets, raw events, selections, or exception causes.

The preferred vulnerability channel is GitHub Private Vulnerability Reporting after the public repository is created and that feature is enabled. If it is not enabled, use a private contact path arranged by the repository owner; do not disclose vulnerability details in a public issue. No email address is invented here.

Only the current default branch and the most recent GitHub Release, if one exists, are supported on a best-effort basis. Forks, old releases, and modified deployments are outside the support promise. The owner may stop maintenance or archive the project without an SLA.

Custom strategies, keyboard filters, and output sinks are trusted host code, not security sandboxes. The native editable adapter refuses password inputs in this version. The public DOM events are an observable same-page data surface; `composed: false` is not a confidentiality boundary.
