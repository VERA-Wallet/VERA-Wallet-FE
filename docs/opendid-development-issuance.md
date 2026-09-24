# Development credential reissuance

DID CA ADD VC opens `/opendid/addVcInfo?did=...&vcSchemaId=verawallet-dev`.
The public route renders a self-contained confirmation page. Its button invokes
`android.onCompletedAddVcUpload()` to resume the native PIN/biometric and issuer
protocol. This callback is not evidence of successful issuance.

Development holder records and fixed subject claims must already be provisioned
by the operator in the issuer. This page neither registers a holder nor saves
claims; the issuer remains responsible for holder proof and eligibility. It does
not accept report schemas. The upstream Demo server's `save-user-info` API stays
private, preventing self-selected identity claims from becoming public input.

After deleting only the development VC, use ADD VC → VeraWallet Development
Credential → OK → 인증하고 발급 계속하기 → native approval. A new device/DID still
requires operator provisioning. Report VC issuance uses its existing QR flow.
